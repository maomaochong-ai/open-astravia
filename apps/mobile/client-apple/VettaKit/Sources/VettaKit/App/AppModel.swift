import Foundation
import Observation
import os

private let log = Logger(subsystem: "com.openvetta.mobile", category: "app")

public enum ConfirmPolicy: String, Codable, CaseIterable, Sendable {
	case major, important, auto
}

public struct Preferences: Equatable, Codable, Sendable {
	public var liveThinking: Bool
	public var haptics: Bool
	public var confirmPolicy: ConfirmPolicy

	public static let defaults = Preferences(liveThinking: true, haptics: true, confirmPolicy: .important)

	static func decode(_ raw: String?) -> Preferences {
		guard let raw, let value = try? JSONValue.parse(raw), value.isObject else { return .defaults }
		return Preferences(
			liveThinking: value["liveThinking"]?.boolValue != false,
			haptics: value["haptics"]?.boolValue != false,
			confirmPolicy: value["confirmPolicy"]?.stringValue.flatMap(ConfirmPolicy.init(rawValue:)) ?? .important
		)
	}
}

/// What the app needs from the device; tests swap in memory stores and fake transports.
public struct AppPlatform {
	public var settings: KeyValueStore
	public var secrets: KeyValueStore
	public var cache: SessionCache
	public var createTransport: TransportFactory
	public var deviceName: String
	public var onTurnEnd: (() -> Void)?
	public var configureManager: ((inout ChannelManagerOptions) -> Void)?
	public var configurePairing: ((inout PairingFlowOptions) -> Void)?

	public init(settings: KeyValueStore, secrets: KeyValueStore, cache: SessionCache, createTransport: @escaping TransportFactory, deviceName: String, onTurnEnd: (() -> Void)? = nil) {
		self.settings = settings
		self.secrets = secrets
		self.cache = cache
		self.createTransport = createTransport
		self.deviceName = deviceName
		self.onTurnEnd = onTurnEnd
	}

	public static func memory(createTransport: @escaping TransportFactory, deviceName: String = "Phone") -> AppPlatform {
		AppPlatform(settings: MemoryKeyValueStore(), secrets: MemoryKeyValueStore(), cache: MemorySessionCache(), createTransport: createTransport, deviceName: deviceName)
	}
}

/// The phone's whole state and every user action (port of the zustand `app-store.ts`).
@Observable
public final class AppModel {
	static let preferencesKey = "vetta.preferences"
	static let deviceIdKey = "vetta.device.id"
	static let projectsKeyPrefix = "vetta.projects."

	public private(set) var ready = false
	public private(set) var paired = false
	public private(set) var desktop: StoredDesktop?
	public private(set) var link: LinkSnapshot = .offline
	public private(set) var sessions: [RemoteSessionSummary] = []
	public private(set) var sessionsLoaded = false
	/// The desktop's project list, the conversation bucket first. Kept across
	/// launches so filtering by kind works before the link comes up.
	public private(set) var projects: [RemoteProjectSummary] = []
	/// Models each opened session may switch to, fetched on demand.
	public private(set) var models: [String: [RemoteModelOption]] = [:]
	/// Models a new session may start with; see `loadNewSessionModels`.
	public private(set) var newSessionModels: [RemoteModelOption] = []
	public private(set) var transcripts: [String: TranscriptState] = [:]
	/// Sessions opened by `startSession`: the local id the chat opened on → the desktop's id.
	public private(set) var startedSessions: [String: String] = [:]
	public private(set) var startingSessions: Set<String> = []
	public private(set) var preferences: Preferences = .defaults
	public private(set) var pairing: PairingPhase = .idle
	public var lastError: String?

	@ObservationIgnored private let platform: AppPlatform
	@ObservationIgnored private let pairingStore: PairingStore
	@ObservationIgnored private var identity: LinkIdentity!
	@ObservationIgnored private var manager: ChannelManager?
	@ObservationIgnored private var desktopKey: String?
	@ObservationIgnored private var flow: PairingFlow?
	@ObservationIgnored private var unsubscribe: [() -> Void] = []
	@ObservationIgnored private var transcriptSave: [String: Task<Void, Never>] = [:]
	@ObservationIgnored private var active = true

	public init(platform: AppPlatform) {
		self.platform = platform
		pairingStore = PairingStore(settings: platform.settings, secrets: platform.secrets)
	}

	public var online: Bool { link.isUsable }

	public var conversationCwd: String? { projects.first(where: \.isConversation)?.cwd }

	public func count(_ group: SessionStatusGroup) -> Int {
		sessions.count { SessionStatusGroup($0.status) == group }
	}

	public func transcript(_ sessionId: String) -> TranscriptState { transcripts[sessionId] ?? .empty }

	public func session(_ sessionId: String) -> RemoteSessionSummary? { sessions.first { $0.id == sessionId } }

	// MARK: Lifecycle

	public func start() {
		guard !ready else { return }
		pairingStore.load()
		identity = LinkIdentity(identity: pairingStore.getIdentity(), deviceId: loadDeviceId(), deviceName: platform.deviceName)
		preferences = Preferences.decode(platform.settings.get(Self.preferencesKey))
		if let current = pairingStore.getCurrent() { attachManager(current) }
		ready = true
	}

	/// Scene became active or inactive.
	public func setActive(_ value: Bool) {
		let wasActive = active
		active = value
		manager?.setForeground(value)
		if value, !wasActive { manager?.refresh() }
	}

	private func loadDeviceId() -> String {
		if let existing = platform.settings.get(Self.deviceIdKey) { return existing }
		let created = "mobile-\(RemoteCrypto.randomToken(bytes: 8))"
		platform.settings.set(Self.deviceIdKey, created)
		return created
	}

	// MARK: Pairing

	public func pairWithCode(_ text: String) async -> Bool {
		let flow = startFlow()
		guard let record = await flow.pairWithCode(text) else { return false }
		return finishPairing(record)
	}

	public func pairManually(_ endpoint: String) async -> Bool {
		let flow = startFlow()
		guard let record = await flow.pairManually(endpoint) else { return false }
		return finishPairing(record)
	}

	public func cancelPairing() {
		flow?.cancel()
		flow = nil
		pairing = .idle
	}

	public func unpair() {
		let key = desktopKey
		detachManager()
		if let key {
			pairingStore.revoke(key)
			platform.cache.clearDesktop(key)
			platform.settings.remove(Self.projectsKeyPrefix + key)
		}
		desktopKey = nil
		paired = false
		desktop = nil
		sessions = []
		sessionsLoaded = false
		projects = []
		models = [:]
		transcripts = [:]
		link = .offline
	}

	private func startFlow() -> PairingFlow {
		flow?.cancel()
		var options = PairingFlowOptions(link: identity, createTransport: platform.createTransport) { [weak self] phase in
			self?.pairing = phase
		}
		platform.configurePairing?(&options)
		let flow = PairingFlow(options: options)
		self.flow = flow
		return flow
	}

	private func finishPairing(_ record: DesktopRecord) -> Bool {
		pairingStore.save(record)
		attachManager(record)
		pairing = .idle
		return true
	}

	// MARK: Link

	public func refreshLink() {
		manager?.refresh()
	}

	private func attachManager(_ record: DesktopRecord) {
		detachManager()
		let key = record.desktopIdentityKey
		desktopKey = key
		let cached = platform.cache.loadSessions(key)
		paired = true
		desktop = record.stored
		sessions = cached
		sessionsLoaded = !cached.isEmpty
		projects = loadProjects(key)
		transcripts = [:]
		link = .offline
		var options = ChannelManagerOptions(desktop: record, link: identity, createTransport: platform.createTransport)
		options.onSequence = { [weak self] sequence in
			self?.pairingStore.update(key) {
				$0.lastEventSequence = sequence
				$0.lastSeenAt = WallClock.nowMs()
			}
		}
		options.onLanEndpoints = { [weak self] endpoints in
			self?.pairingStore.update(key) { $0.lanEndpoints = endpoints }
		}
		platform.configureManager?(&options)
		let manager = ChannelManager(options: options)
		self.manager = manager
		unsubscribe.append(manager.subscribe { [weak self] next in
			guard let self else { return }
			let wasOnline = self.link.isUsable
			self.link = next
			if !wasOnline, next.isUsable { Task { await self.refreshSessions() } }
		})
		unsubscribe.append(manager.onEvent { [weak self] event in self?.handleEvent(event) })
		manager.setForeground(active)
		manager.start()
	}

	private func detachManager() {
		for off in unsubscribe { off() }
		unsubscribe.removeAll()
		manager?.stop()
		manager = nil
	}

	private func requireManager() throws -> ChannelManager {
		guard let manager else { throw LinkOfflineError() }
		return manager
	}

	private func reportError(_ error: Error, _ action: String = #function) {
		// Diagnostic metadata only: never prompts, payloads or credentials.
		log.error("\(action, privacy: .public) failed: \(String(describing: type(of: error)), privacy: .public) \(error.localizedDescription, privacy: .public)")
		lastError = error is LinkOfflineError ? L10n.Common.notConnected : L10n.Common.unknownError
	}

	// MARK: Events

	private func dispatch(_ sessionId: String, _ action: TranscriptAction) {
		let next = TranscriptReducer.reduce(transcripts[sessionId] ?? .empty, action)
		transcripts[sessionId] = next
		scheduleTranscriptSave(sessionId, next)
	}

	private func scheduleTranscriptSave(_ sessionId: String, _ transcript: TranscriptState) {
		guard let key = desktopKey, !transcript.stale, transcript.loaded else { return }
		transcriptSave[sessionId]?.cancel()
		transcriptSave[sessionId] = schedule(after: 400) { [weak self] in
			self?.transcriptSave[sessionId] = nil
			self?.platform.cache.saveTranscript(key, sessionId, transcript.items)
		}
	}

	private func patchSession(_ sessionId: String, _ patch: (inout RemoteSessionSummary) -> Void) {
		guard let index = sessions.firstIndex(where: { $0.id == sessionId }) else { return }
		patch(&sessions[index])
	}

	private func handleEvent(_ event: RemoteEvent) {
		let sessionId = event.sessionId
		switch event.name {
		case .sessionList:
			let list = RemoteAPI.readSessionSummaries(event.payload)
			sessions = list
			sessionsLoaded = true
			if let key = desktopKey { platform.cache.saveSessions(key, list) }
		case .sessionState:
			guard let sessionId else { return }
			dispatch(sessionId, .state(RemoteAPI.readSessionState(event.payload)))
			// The reducer keeps a pending question over a plain "running"; the list follows it.
			let status = transcript(sessionId).sessionState.status
			patchSession(sessionId) {
				$0.status = status
				$0.updatedAt = WallClock.nowMs()
			}
		case .sessionMessage:
			guard let sessionId, let message = RemoteAPI.readMessageEvent(event.payload) else { return }
			if case .thinkingDelta = message, !preferences.liveThinking { return }
			dispatch(sessionId, .message(message))
			if case .turnEnd = message, preferences.haptics, active { platform.onTurnEnd?() }
			if case let .user(text, at) = message {
				patchSession(sessionId) {
					$0.preview = text
					$0.updatedAt = at
				}
			}
		case .sessionTool:
			guard let sessionId, let tool = RemoteAPI.readToolEvent(event.payload) else { return }
			dispatch(sessionId, .tool(tool))
		case .sessionInput:
			guard let sessionId, let payload = event.payload else { return }
			switch payload["kind"]?.stringValue {
			case "question":
				guard let request = RemoteAPI.readQuestionRequest(payload["request"]) else { return }
				dispatch(sessionId, .question(request))
				patchSession(sessionId) {
					$0.status = .waitingInput
					$0.updatedAt = WallClock.nowMs()
				}
			case "resolved":
				guard let requestId = payload["requestId"]?.stringValue else { return }
				dispatch(sessionId, .questionResolved(requestId: requestId))
			default:
				return
			}
		case .sessionResync:
			transcripts = transcripts.mapValues { TranscriptReducer.reduce($0, .resync) }
			Task { await refreshSessions() }
		default:
			return
		}
	}

	// MARK: Actions

	public func refreshSessions() async {
		do {
			let result = try await requireManager().request(.sessionList, payload: ["limit": 200])
			let list = RemoteAPI.readSessionSummaries(result)
			sessions = list
			sessionsLoaded = true
			if let key = desktopKey { platform.cache.saveSessions(key, list) }
			await refreshProjects()
		} catch {
			if !(error is LinkOfflineError) { reportError(error) }
		}
	}

	public func refreshProjects() async {
		do {
			let result = try await requireManager().request(.projectList)
			let list = RemoteAPI.readProjectSummaries(result)
			guard !list.isEmpty else { return }
			projects = list
			if let key = desktopKey, let data = try? JSONEncoder().encode(list), let text = String(data: data, encoding: .utf8) {
				platform.settings.set(Self.projectsKeyPrefix + key, text)
			}
		} catch {
			if !(error is LinkOfflineError) { reportError(error) }
		}
	}

	private func loadProjects(_ desktopKey: String) -> [RemoteProjectSummary] {
		guard let text = platform.settings.get(Self.projectsKeyPrefix + desktopKey) else { return [] }
		return (try? JSONDecoder().decode([RemoteProjectSummary].self, from: Data(text.utf8))) ?? []
	}

	public func openSession(_ sessionId: String) async {
		if transcripts[sessionId] == nil, let key = desktopKey, let cached = platform.cache.loadTranscript(key, sessionId) {
			var restored = TranscriptState.empty
			restored.items = cached
			restored.loaded = true
			restored.stale = true
			transcripts[sessionId] = restored
		}
		do {
			let manager = try requireManager()
			let opened = try await manager.request(.sessionOpen, sessionId: sessionId)
			let history = try await manager.request(.sessionHistory, sessionId: sessionId)
			let entries = RemoteAPI.readTranscriptEntries(history)
			let state = RemoteAPI.readSessionState(history?["state"] ?? opened?["state"])
			dispatch(sessionId, .history(entries: entries, state: state))
			patchSession(sessionId) {
				$0.status = state.status
				$0.live = true
			}
		} catch {
			if !(error is LinkOfflineError) { reportError(error) }
		}
	}

	public func loadModels(_ sessionId: String) async {
		do {
			let result = try await requireManager().request(.modelList, sessionId: sessionId)
			models[sessionId] = RemoteAPI.readModelOptions(result)
		} catch {
			// An older desktop does not know `model.list`; the title then just shows the model.
			log.info("model.list unavailable: \(String(describing: type(of: error)), privacy: .public)")
		}
	}

	/// The desktop lists models per session and every session reads the same
	/// registry, so a new session borrows the list of the most recent one.
	public func loadNewSessionModels() async {
		guard let recent = sessions.max(by: { $0.updatedAt < $1.updatedAt }) else { return }
		await loadModels(recent.id)
		if let options = models[recent.id] { newSessionModels = options }
	}

	/// Switches the session's model and/or thinking level on the desktop.
	@discardableResult
	public func configure(_ sessionId: String, modelKey: String? = nil, thinkingLevel: String? = nil) async -> Bool {
		var payload: [String: JSONValue] = [:]
		if let modelKey { payload["modelKey"] = .string(modelKey) }
		if let thinkingLevel { payload["thinkingLevel"] = .string(thinkingLevel) }
		guard !payload.isEmpty else { return false }
		do {
			let result = try await requireManager().request(.sessionConfigure, payload: .object(payload), sessionId: sessionId)
			dispatch(sessionId, .state(RemoteAPI.readSessionState(result?["state"])))
			return true
		} catch {
			reportError(error)
			return false
		}
	}

	/// Sends a prompt; with no session a new one is created first, in `projectCwd`
	/// or, without one, in the desktop's conversations. Attachments are uploaded one
	/// per request first. `modelKey` switches a newly created session before the prompt.
	/// Returns the session that received it, or nil when nothing was sent.
	@discardableResult
	public func sendPrompt(_ sessionId: String?, _ text: String, projectCwd: String? = nil, modelKey: String? = nil, attachments: [PromptAttachment] = []) async -> String? {
		let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
		guard !trimmed.isEmpty else { return nil }
		do {
			var target = sessionId
			if target == nil {
				let created = try await createSession(projectCwd: projectCwd)
				// A failed switch is reported; the prompt still goes out on the default model.
				if let modelKey { await configure(created, modelKey: modelKey) }
				target = created
			}
			guard let target else { return sessionId }
			try await deliver(target, trimmed, attachments: attachments, echo: true)
			return target
		} catch {
			reportError(error)
			return nil
		}
	}

	/// Starts a session without waiting on the desktop. The chat opens on the
	/// returned local id with the prompt already in it, while the session is
	/// created, switched to `modelKey` and sent the attachments and the prompt in
	/// the background; `resolve` then maps the local id to the desktop's.
	/// `onFailure` runs when the prompt did not go out. Nil when there is no text.
	public func startSession(
		_ text: String,
		projectCwd: String? = nil,
		modelKey: String? = nil,
		attachments: [PromptAttachment] = [],
		onFailure: @escaping @MainActor () -> Void = {}
	) -> String? {
		let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
		guard !trimmed.isEmpty else { return nil }
		let localId = "local-session-\(UUID().uuidString)"
		// Assigned rather than dispatched: a local id has nothing to cache.
		var transcript = TranscriptReducer.reduce(.empty, .history(entries: [], state: RemoteSessionState(status: .running)))
		transcript = TranscriptReducer.reduce(transcript, .localUser(
			text: trimmed,
			at: WallClock.nowMs(),
			attachments: attachments.map { TranscriptAttachment(kind: $0.kind, name: $0.name) }
		))
		transcripts[localId] = transcript
		startingSessions.insert(localId)
		Task {
			defer { startingSessions.remove(localId) }
			do {
				let target = try await createSession(projectCwd: projectCwd)
				// Hand the chat over before anything is sent, so the desktop's events land in it.
				transcripts[target] = transcripts.removeValue(forKey: localId)
				startedSessions[localId] = target
				if let modelKey { await configure(target, modelKey: modelKey) }
				try await deliver(target, trimmed, attachments: attachments, echo: false)
			} catch {
				transcripts[localId] = nil
				reportError(error)
				onFailure()
			}
		}
		return localId
	}

	/// The desktop's id for a session started with `startSession`, or `sessionId` itself.
	public func resolve(_ sessionId: String) -> String { startedSessions[sessionId] ?? sessionId }

	/// Whether the first prompt of a session started with `startSession` is still on its way.
	public func isStarting(_ sessionId: String) -> Bool { startingSessions.contains(sessionId) }

	private func createSession(projectCwd: String?) async throws -> String {
		let payload: JSONValue? = projectCwd.map { ["projectCwd": .string($0)] }
		let created = try await requireManager().request(.sessionCreate, payload: payload)
		guard let session = RemoteAPI.readSessionSummary(created?["session"]) else {
			throw RemoteRequestError("session.create returned no session")
		}
		sessions = [session] + sessions.filter { $0.id != session.id }
		dispatch(session.id, .history(entries: [], state: RemoteSessionState(status: .idle)))
		return session.id
	}

	/// Uploads the attachments, then sends the prompt; `echo` shows it in the chat first.
	private func deliver(_ target: String, _ text: String, attachments: [PromptAttachment], echo: Bool) async throws {
		let manager = try requireManager()
		var uploadIds: [JSONValue] = []
		for attachment in attachments {
			let uploaded = try await manager.request(.sessionUpload, payload: attachment.json, sessionId: target)
			guard let uploadId = uploaded?["uploadId"]?.stringValue else {
				throw RemoteRequestError("session.upload returned no uploadId")
			}
			uploadIds.append(.string(uploadId))
		}
		let now = WallClock.nowMs()
		if echo {
			dispatch(target, .localUser(text: text, at: now, attachments: attachments.map { TranscriptAttachment(kind: $0.kind, name: $0.name) }))
		}
		dispatch(target, .state(RemoteSessionState(status: .running)))
		let title = currentTitle(target, fallback: text)
		patchSession(target) {
			$0.status = .running
			$0.preview = text
			$0.updatedAt = now
			$0.title = title
		}
		var payload: [String: JSONValue] = ["text": .string(text)]
		if !uploadIds.isEmpty { payload["attachments"] = .array(uploadIds) }
		_ = try await manager.request(.sessionPrompt, payload: .object(payload), sessionId: target)
	}

	public func respond(_ sessionId: String, requestId: String, answers: [RemoteQuestionAnswer], cancelled: Bool = false) async {
		do {
			let payload: JSONValue = [
				"requestId": .string(requestId),
				"cancelled": .bool(cancelled),
				"answers": .array(answers.map(\.json)),
			]
			_ = try await requireManager().request(.sessionRespond, payload: payload, sessionId: sessionId)
			dispatch(sessionId, .questionResolved(requestId: requestId))
			patchSession(sessionId) { $0.status = .running }
		} catch {
			reportError(error)
		}
	}

	public func abort(_ sessionId: String) async {
		do {
			_ = try await requireManager().request(.sessionAbort, sessionId: sessionId)
		} catch {
			reportError(error)
		}
	}

	public func resync(_ sessionId: String) async {
		dispatch(sessionId, .resync)
		await openSession(sessionId)
		await refreshSessions()
	}

	public func setPreferences(_ update: (inout Preferences) -> Void) {
		var next = preferences
		update(&next)
		preferences = next
		if let data = try? JSONEncoder().encode(next), let text = String(data: data, encoding: .utf8) {
			platform.settings.set(Self.preferencesKey, text)
		}
	}

	public func clearError() {
		lastError = nil
	}

	private func currentTitle(_ sessionId: String, fallback: String) -> String {
		if let existing = session(sessionId)?.title, !existing.trimmingCharacters(in: .whitespaces).isEmpty { return existing }
		return String(fallback.prefix(60))
	}
}
