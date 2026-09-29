import Foundation
import Observation
import os

private let log = Logger(subsystem: "com.openvetta.mobile", category: "app")

public struct Preferences: Equatable, Codable, Sendable {
	public var liveThinking: Bool
	public var haptics: Bool

	public static let defaults = Preferences(liveThinking: true, haptics: true)

	static func decode(_ raw: String?) -> Preferences {
		guard let raw, let value = try? JSONValue.parse(raw), value.isObject else { return .defaults }
		return Preferences(
			liveThinking: value["liveThinking"]?.boolValue != false,
			haptics: value["haptics"]?.boolValue != false
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
	public var onTurnStart: (() -> Void)?
	public var onTurnEnd: (() -> Void)?
	public var signals: SessionSignals?
	public var configureManager: ((inout ChannelManagerOptions) -> Void)?
	public var configurePairing: ((inout PairingFlowOptions) -> Void)?
	public var inviteLookup = InviteCodeLookup()

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
	static let modelsKeyPrefix = "vetta.models."
	static let lastModelKeyPrefix = "vetta.lastModel."

	public private(set) var ready = false
	public private(set) var paired = false
	public private(set) var desktop: StoredDesktop?
	public private(set) var link: LinkSnapshot = .offline
	public private(set) var sessions: [RemoteSessionSummary] = [] {
		didSet { sessionsChanged(from: oldValue) }
	}
	public private(set) var sessionsLoaded = false
	/// The desktop's project list, the conversation bucket first. Kept across
	/// launches so filtering by kind works before the link comes up.
	public private(set) var projects: [RemoteProjectSummary] = []
	/// Models each opened session may switch to, fetched on demand.
	public private(set) var models: [String: [RemoteModelOption]] = [:]
	/// Models a new session may start with, kept across launches; see `loadNewSessionModels`.
	public private(set) var newSessionModels: [RemoteModelOption] = []
	/// The model and level last used on this desktop, to start or switch a session;
	/// New Session starts on it. Kept across launches.
	public private(set) var lastModelChoice = ModelChoice()
	/// Skills the composer may reference, per project; "" holds the global ones.
	/// In memory only: `loadSkills` refreshes a list each time the picker opens.
	public private(set) var skillCatalogs: [String: SkillCatalog] = [:]
	public private(set) var transcripts: [String: TranscriptState] = [:]
	/// Sessions opened by `startSession`: the local id the chat opened on → the desktop's id.
	public private(set) var startedSessions: [String: String] = [:]
	public private(set) var startingSessions: Set<String> = []
	public private(set) var preferences: Preferences = .defaults
	public private(set) var pairing: PairingPhase = .idle
	public var lastError: String?
	/// What the desktop said about its screen while the remote desktop page is open; nil
	/// otherwise (ADR-0140).
	public private(set) var screen: RemoteScreenStatus?
	/// The desktop's pointer shape while the remote desktop is open; nil until it says, or
	/// from a desktop that cannot (the phone then draws a plain arrow).
	public private(set) var screenCursor: RemoteScreenCursor?

	@ObservationIgnored private let platform: AppPlatform
	@ObservationIgnored private let pairingStore: PairingStore
	@ObservationIgnored private var identity: LinkIdentity!
	@ObservationIgnored private var manager: ChannelManager?
	@ObservationIgnored private var desktopKey: String?
	@ObservationIgnored private var flow: PairingFlow?
	@ObservationIgnored private var unsubscribe: [() -> Void] = []
	@ObservationIgnored private var transcriptSave: [String: Task<Void, Never>] = [:]
	@ObservationIgnored private var active = true
	/// The remote desktop page is open; the desktop captures only while it is and the app is in front.
	@ObservationIgnored private var screenOpen = false
	@ObservationIgnored private var newSessionModelsLoad: Task<Void, Never>?
	/// Sessions `startSession` just sent their first prompt to; see `openSession`.
	@ObservationIgnored private var freshSessions: Set<String> = []
	@ObservationIgnored private let fileCache = FileContentCache()
	@ObservationIgnored private var watch = SessionWatch()
	/// Sessions whose latest user message has no reply yet; the first output buzzes once.
	@ObservationIgnored private var awaitingOutput: Set<String> = []

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

	/// Whether the connected desktop serves `panel`; false until its status arrives.
	public func isAvailable(_ panel: SessionPanel) -> Bool { panel.isAvailable(on: link.desktop) }

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
		if screenOpen, value != wasActive { syncScreen() }
		if value != wasActive { platform.signals?.show(liveDigest, active: value) }
	}

	/// Woken in the background: reconnects, fetches the list and returns once it is
	/// in, or when `timeoutMs` runs out. What changed meanwhile raises its alerts.
	public func refreshInBackground(timeoutMs: Double = 20_000) async {
		guard await reconnect(timeoutMs: timeoutMs) else { return }
		await refreshSessions()
	}

	/// Answers a question from the Live Activity, which may have woken the app in
	/// the background. False when it did not reach the desktop.
	public func answer(_ sessionId: String, requestId: String, question: String, choice: String, timeoutMs: Double = 20_000) async -> Bool {
		start()
		guard await reconnect(timeoutMs: timeoutMs) else { return false }
		return await respond(sessionId, requestId: requestId, answers: [RemoteQuestionAnswer(question: question, answers: [choice])])
	}

	/// Brings the link up if it is down and waits for it, without treating the app as in front.
	private func reconnect(timeoutMs: Double) async -> Bool {
		guard let manager else { return false }
		manager.refresh()
		defer { manager.setForeground(active) }
		let deadline = WallClock.nowMs() + timeoutMs
		while !online, WallClock.nowMs() < deadline {
			try? await Task.sleep(nanoseconds: 200_000_000)
		}
		return online
	}

	private var liveDigest: LiveDigest {
		watch.digest(sessions) { [transcripts] sessionId in transcripts[sessionId]?.pendingQuestion }
	}

	private func loadDeviceId() -> String {
		if let existing = platform.settings.get(Self.deviceIdKey) { return existing }
		let created = "mobile-\(RemoteCrypto.randomToken(bytes: 8))"
		platform.settings.set(Self.deviceIdKey, created)
		return created
	}

	// MARK: Pairing

	/// Pairs with what a QR code or link holds: a whole pairing link, or just a connection
	/// code and password (ADR-0138), which is then looked up on the relay.
	public func pairWithCode(_ text: String) async -> Bool {
		if let qr = InviteCode.parseQR(text) {
			return await pairWithInvite(code: qr.code, password: qr.password, relayBaseUrl: qr.relayBaseUrl)
		}
		let flow = startFlow()
		guard let record = await flow.pairWithCode(text) else { return false }
		return finishPairing(record)
	}

	/// Pairs with the desktop whose invite waits on the relay under a connection code
	/// (ADR-0136); from there it is the same as scanning its QR code. `relayBaseUrl` is
	/// what was typed for a desktop on its own relay, nil for the default one.
	public func pairWithInvite(code: String, password: String, relayBaseUrl: String? = nil) async -> Bool {
		let flow = startFlow()
		pairing = .connecting(via: .relay)
		let found = await platform.inviteLookup.lookup(code: code, password: password, relayBaseUrl: InviteCode.relayBaseUrl(typed: relayBaseUrl))
		// Cancelled, or another pairing started, while the relay was asked.
		guard self.flow === flow else { return false }
		let uri: String
		switch found {
		case let .found(link): uri = link
		case .notFound: pairing = .failed(.inviteNotFound); return false
		case .wrongPassword: pairing = .failed(.inviteWrongPassword); return false
		case .unreachable: pairing = .failed(.inviteUnreachable); return false
		}
		guard let record = await flow.pairWithCode(uri) else { return false }
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
			platform.settings.remove(Self.modelsKeyPrefix + key)
			platform.settings.remove(Self.lastModelKeyPrefix + key)
		}
		desktopKey = nil
		paired = false
		desktop = nil
		sessions = []
		sessionsLoaded = false
		projects = []
		models = [:]
		newSessionModels = []
		skillCatalogs = [:]
		lastModelChoice = ModelChoice()
		transcripts = [:]
		fileCache.removeAll()
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
		models = [:]
		newSessionModels = cachedNewSessionModels(key)
		skillCatalogs = [:]
		lastModelChoice = platform.settings.get(Self.lastModelKeyPrefix + key)
			.flatMap { try? JSONDecoder().decode(ModelChoice.self, from: Data($0.utf8)) } ?? ModelChoice()
		transcripts = [:]
		freshSessions = []
		fileCache.removeAll()
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
		screen = nil
	}

	// MARK: Remote desktop

	/// The relay's viewer signaling for the paired desktop's screen and the P2P channel;
	/// nil without a relay to reach it through.
	public var remoteDesktopTarget: String? {
		guard let record = pairingStore.getCurrent(), let relay = record.relayBaseUrl, !relay.isEmpty else { return nil }
		return PairingURI.desktopViewerUrl(relayBaseUrl: relay, pairingId: record.pairingId, mobileSecret: record.mobileSecret)
	}

	/// The remote desktop page opened or closed: the desktop starts or stops capturing (ADR-0140).
	public func setScreenOpen(_ open: Bool) {
		guard screenOpen != open else { return }
		screenOpen = open
		syncScreen()
	}

	private func syncScreen() {
		let wanted = screenOpen && active
		if !wanted {
			screen = nil
			screenCursor = nil
		}
		// Only a desktop that captures on demand knows the request; with any other the
		// phone never opens the P2P link that would carry its screen.
		guard let manager, link.desktop?.screen == true, link.isUsable else { return }
		Task {
			do {
				// `cursor`: this phone draws the pointer itself and wants its shape.
				let result = try await manager.request(.screenSubscribe, payload: ["active": .bool(wanted), "cursor": .bool(wanted)])
				// A later open or close has its own answer coming.
				guard wanted == (self.screenOpen && self.active) else { return }
				self.screen = wanted ? RemoteAPI.readScreenStatus(result) : nil
			} catch {
				log.error("screen subscription failed: \(String(describing: type(of: error)), privacy: .public)")
			}
		}
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

	private func sessionsChanged(from old: [RemoteSessionSummary]) {
		guard let signals = platform.signals else { return }
		let alerts = watch.update(from: old, to: sessions) { [transcripts] sessionId in
			transcripts[sessionId]?.pendingQuestion?.questions.first?.question
		}
		let waitingNow = Set(sessions.filter { $0.status == .waitingInput }.map(\.id))
		for session in old where session.status == .waitingInput && !waitingNow.contains(session.id) {
			signals.withdraw(session.id)
		}
		if !active { alerts.forEach(signals.alert) }
		signals.show(liveDigest, active: active)
	}

	private func outputStarted(_ sessionId: String) {
		guard awaitingOutput.remove(sessionId) != nil, preferences.haptics, active else { return }
		platform.onTurnStart?()
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
			switch message {
			case .user: awaitingOutput.insert(sessionId)
			case .assistantDelta, .thinkingDelta: outputStarted(sessionId)
			case .turnEnd: awaitingOutput.remove(sessionId)
			}
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
			outputStarted(sessionId)
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
			awaitingOutput.removeAll()
			transcripts = transcripts.mapValues { TranscriptReducer.reduce($0, .resync) }
			Task { await refreshSessions() }
		case .deviceStatus:
			// Sent on every connection: a desktop that lost the phone for a moment forgot it was watching.
			if screenOpen, active { syncScreen() }
		case .screenStatus:
			if screenOpen, active, let status = RemoteAPI.readScreenStatus(event.payload) { screen = status }
		case .screenCursor:
			if screenOpen, active, let cursor = RemoteAPI.readScreenCursor(event.payload) { screenCursor = cursor }
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
			// Ready before New Session opens. Only when it is cheap or there is nothing yet:
			// borrowing a session that is not open makes the desktop load it.
			if newSessionModels.isEmpty || list.contains(where: \.live) { Task { await loadNewSessionModels() } }
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

	/// Fetches the session's history, except right after `startSession`: the desktop
	/// accepts a prompt before its agent records it, so history taken then lacks the
	/// prompt and would wipe it off the chat. The chat already has everything then.
	public func openSession(_ sessionId: String) async {
		platform.signals?.withdraw(sessionId)
		let fresh = freshSessions.remove(sessionId) != nil && transcripts[sessionId]?.stale == false
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
			guard !fresh else {
				patchSession(sessionId) { $0.live = true }
				return
			}
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
			let options = RemoteAPI.readModelOptions(result)
			models[sessionId] = options
			// Every session reads the same registry, so any list also serves New Session.
			if !options.isEmpty { keepNewSessionModels(options) }
		} catch {
			// An older desktop does not know `model.list`; the title then just shows the model.
			log.info("model.list unavailable: \(String(describing: type(of: error)), privacy: .public)")
		}
	}

	// MARK: Skills

	public func skillCatalog(cwd: String?) -> SkillCatalog { skillCatalogs[skillScope(cwd)] ?? SkillCatalog() }

	/// Fetches the skills a prompt in `cwd` may reference; the last list stays
	/// on screen meanwhile. `cwd` is a project, or nil or the conversation root for global ones.
	public func loadSkills(cwd: String?) async {
		let scope = skillScope(cwd)
		guard skillCatalogs[scope]?.loading != true else { return }
		skillCatalogs[scope, default: SkillCatalog()].loading = true
		skillCatalogs[scope]?.failed = false
		do {
			let payload: JSONValue? = scope.isEmpty ? nil : ["cwd": .string(scope)]
			let result = try await requireManager().request(.skillList, payload: payload)
			skillCatalogs[scope] = SkillCatalog(options: RemoteAPI.readSkillOptions(result))
		} catch {
			skillCatalogs[scope]?.loading = false
			skillCatalogs[scope]?.failed = true
			log.info("skill.list failed: \(String(describing: type(of: error)), privacy: .public)")
		}
	}

	/// The desktop's display name for a referenced skill, when any list has it.
	public func skillName(_ skill: SkillReference) -> String {
		for catalog in skillCatalogs.values {
			if let option = catalog.options?.first(where: { $0.id == skill.id }) { return option.displayName }
		}
		return skill.name
	}

	private func skillScope(_ cwd: String?) -> String {
		guard let cwd, !cwd.isEmpty, cwd != conversationCwd else { return "" }
		return cwd
	}

	/// The desktop lists models per session and every session reads the same
	/// registry, so a new session borrows another one's list. A session the desktop
	/// already has open answers at once; any other one is loaded from disk first,
	/// which takes seconds, so an open one is preferred and the last list is kept
	/// for the next launch. Concurrent calls share one request.
	public func loadNewSessionModels() async {
		if let running = newSessionModelsLoad { return await running.value }
		let load = Task { [weak self] in
			guard let self else { return }
			let recent: (RemoteSessionSummary, RemoteSessionSummary) -> Bool = { $0.updatedAt < $1.updatedAt }
			guard let donor = sessions.filter(\.live).max(by: recent) ?? sessions.max(by: recent) else { return }
			await loadModels(donor.id)
		}
		newSessionModelsLoad = load
		await load.value
		newSessionModelsLoad = nil
	}

	private func keepNewSessionModels(_ options: [RemoteModelOption]) {
		guard options != newSessionModels else { return }
		newSessionModels = options
		if let key = desktopKey, let data = try? JSONEncoder().encode(options), let text = String(data: data, encoding: .utf8) {
			platform.settings.set(Self.modelsKeyPrefix + key, text)
		}
	}

	private func cachedNewSessionModels(_ desktopKey: String) -> [RemoteModelOption] {
		guard let text = platform.settings.get(Self.modelsKeyPrefix + desktopKey) else { return [] }
		return (try? JSONDecoder().decode([RemoteModelOption].self, from: Data(text.utf8))) ?? []
	}

	private func rememberModel(_ choice: ModelChoice) {
		guard choice != lastModelChoice else { return }
		lastModelChoice = choice
		if let key = desktopKey, let data = try? JSONEncoder().encode(choice), let text = String(data: data, encoding: .utf8) {
			platform.settings.set(Self.lastModelKeyPrefix + key, text)
		}
	}

	/// Switches the session's model and/or thinking level on the desktop, and
	/// remembers where it landed for the next New Session.
	@discardableResult
	public func configure(_ sessionId: String, modelKey: String? = nil, thinkingLevel: String? = nil) async -> Bool {
		var payload: [String: JSONValue] = [:]
		if let modelKey { payload["modelKey"] = .string(modelKey) }
		if let thinkingLevel { payload["thinkingLevel"] = .string(thinkingLevel) }
		guard !payload.isEmpty else { return false }
		do {
			let result = try await requireManager().request(.sessionConfigure, payload: .object(payload), sessionId: sessionId)
			let state = RemoteAPI.readSessionState(result?["state"])
			dispatch(sessionId, .state(state))
			rememberModel(ModelChoice(modelKey: state.modelKey ?? modelKey, thinkingLevel: state.thinkingLevel ?? thinkingLevel))
			return true
		} catch {
			reportError(error)
			return false
		}
	}

	/// Sends a prompt; with no session a new one is created first, in `projectCwd`
	/// or, without one, in the desktop's conversations. Attachments are uploaded one
	/// per request first. `modelKey` and `thinkingLevel` configure a newly created session before the prompt.
	/// Returns the session that received it, or nil when nothing was sent.
	@discardableResult
	public func sendPrompt(_ sessionId: String?, _ text: String, projectCwd: String? = nil, modelKey: String? = nil, thinkingLevel: String? = nil, attachments: [PromptAttachment] = []) async -> String? {
		let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
		guard !trimmed.isEmpty else { return nil }
		do {
			var target = sessionId
			if target == nil {
				rememberModel(ModelChoice(modelKey: modelKey, thinkingLevel: thinkingLevel))
				let created = try await createSession(projectCwd: projectCwd)
				// A failed switch is reported; the prompt still goes out on the default model.
				await configure(created, modelKey: modelKey, thinkingLevel: thinkingLevel)
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
	/// created, switched to `modelKey` and `thinkingLevel` and sent the attachments and the prompt in
	/// the background; `resolve` then maps the local id to the desktop's.
	/// `onFailure` runs when the prompt did not go out. Nil when there is no text.
	public func startSession(
		_ text: String,
		projectCwd: String? = nil,
		modelKey: String? = nil,
		thinkingLevel: String? = nil,
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
		rememberModel(ModelChoice(modelKey: modelKey, thinkingLevel: thinkingLevel))
		Task {
			defer { startingSessions.remove(localId) }
			do {
				let target = try await createSession(projectCwd: projectCwd)
				// Hand the chat over before anything is sent, so the desktop's events land in it.
				transcripts[target] = transcripts.removeValue(forKey: localId)
				startedSessions[localId] = target
				await configure(target, modelKey: modelKey, thinkingLevel: thinkingLevel)
				try await deliver(target, trimmed, attachments: attachments, echo: false)
				freshSessions.insert(target)
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

	@discardableResult
	public func respond(_ sessionId: String, requestId: String, answers: [RemoteQuestionAnswer], cancelled: Bool = false) async -> Bool {
		do {
			let payload: JSONValue = [
				"requestId": .string(requestId),
				"cancelled": .bool(cancelled),
				"answers": .array(answers.map(\.json)),
			]
			_ = try await requireManager().request(.sessionRespond, payload: payload, sessionId: sessionId)
			dispatch(sessionId, .questionResolved(requestId: requestId))
			// The desktop's next state may already be in, e.g. the turn it ended.
			patchSession(sessionId) { if $0.status == .waitingInput { $0.status = .running } }
			return true
		} catch {
			reportError(error)
			return false
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

	/// Renames the session on the desktop; the sidebar there shows the new title too.
	@discardableResult
	public func rename(_ sessionId: String, to title: String) async -> Bool {
		let trimmed = title.trimmingCharacters(in: .whitespacesAndNewlines)
		guard !trimmed.isEmpty else { return false }
		do {
			let result = try await requireManager().request(.sessionRename, payload: ["title": .string(trimmed)], sessionId: sessionId)
			adopt(result?["session"])
			return true
		} catch {
			reportError(error)
			return false
		}
	}

	/// Pins or unpins the session, the same pin as the desktop sidebar's. The list
	/// moves at once; the desktop's pin time replaces the phone's when it answers.
	@discardableResult
	public func setPinned(_ sessionId: String, _ pinned: Bool) async -> Bool {
		let before = session(sessionId)?.pinnedAt
		patchSession(sessionId) { $0.pinnedAt = pinned ? WallClock.nowMs() : nil }
		do {
			let result = try await requireManager().request(.sessionPin, payload: ["pinned": .bool(pinned)], sessionId: sessionId)
			adopt(result?["session"])
			return true
		} catch {
			patchSession(sessionId) { $0.pinnedAt = before }
			reportError(error)
			return false
		}
	}

	/// Deletes the session on the desktop, and with it everything kept here.
	@discardableResult
	public func deleteSession(_ sessionId: String) async -> Bool {
		do {
			_ = try await requireManager().request(.sessionDelete, sessionId: sessionId)
			sessions.removeAll { $0.id == sessionId }
			transcripts[sessionId] = nil
			models[sessionId] = nil
			// Saving the list without it drops its cached transcript too.
			if let key = desktopKey { platform.cache.saveSessions(key, sessions) }
			return true
		} catch {
			reportError(error)
			return false
		}
	}

	/// Takes the title and pin from a summary the desktop just returned; the status
	/// stays as the live events left it.
	private func adopt(_ value: JSONValue?) {
		guard let summary = RemoteAPI.readSessionSummary(value) else { return }
		patchSession(summary.id) {
			$0.title = summary.title
			$0.pinnedAt = summary.pinnedAt
		}
		if let key = desktopKey { platform.cache.saveSessions(key, sessions) }
	}

	// MARK: Files (ADR-0139)

	/// Lists a folder of the session's working directory; `path` is "" for the directory itself
	/// or a path the desktop gave earlier.
	public func listFiles(_ sessionId: String, path: String) async throws(FileViewError) -> FileListing {
		let result = try await fileRequest(.fileList, ["path": .string(path)], sessionId)
		return FileListing(path: result?["path"]?.stringValue ?? path, entries: RemoteAPI.readFileEntries(result))
	}

	/// Describes a file; `path` may be a link exactly as the reply wrote it.
	public func statFile(_ sessionId: String, path: String) async throws(FileViewError) -> RemoteFileInfo {
		let result = try await fileRequest(.fileStat, ["path": .string(path)], sessionId)
		guard let info = RemoteAPI.readFileInfo(result) else { throw .failed }
		return info
	}

	/// The whole file, fetched in chunks, or from memory when it has not changed since.
	public func readFile(_ sessionId: String, _ info: RemoteFileInfo) async throws(FileViewError) -> FileContent {
		guard !info.entry.isDirectory else { throw .notAFile }
		if let cached = fileCache.get(sessionId, info) { return cached }
		do {
			let manager = try requireFileManager()
			let content = try await RemoteFileReader.read(path: info.path, chunkBytes: { RemoteFileReader.chunkBytes(on: link.channel) }) { payload in
				try await manager.request(.fileRead, payload: payload, sessionId: sessionId)
			}
			fileCache.put(sessionId, info, content)
			return content
		} catch {
			throw FileViewError.from(error)
		}
	}

	private func fileRequest(_ method: RemoteRequestMethod, _ payload: [String: JSONValue], _ sessionId: String) async throws(FileViewError) -> JSONValue? {
		do {
			return try await requireFileManager().request(method, payload: .object(payload), sessionId: sessionId)
		} catch {
			throw FileViewError.from(error)
		}
	}

	/// An older desktop drops the link on a method it does not know, so nothing is sent unless it said it serves files.
	private func requireFileManager() throws -> ChannelManager {
		let manager = try requireManager()
		guard online else { throw LinkOfflineError() }
		guard isAvailable(.files) else { throw FileViewError.unsupportedDesktop }
		return manager
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
