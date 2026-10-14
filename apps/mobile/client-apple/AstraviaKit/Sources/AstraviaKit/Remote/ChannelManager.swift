import Foundation

public struct ChannelManagerOptions {
	public var desktop: DesktopRecord
	public var link: LinkIdentity
	public var createTransport: TransportFactory
	public var onSequence: ((Int) -> Void)?
	public var onLanEndpoints: (([String]) -> Void)?
	/// Opens the WebRTC control channel to `p2pTarget`; nil keeps the link on the LAN and relay.
	public var createP2pTransport: ((String) -> RemoteTransport)?
	/// The relay's viewer signaling for this desktop (`PairingURI.desktopViewerUrl`).
	public var p2pTarget: String?
	public var p2pTimeoutMs: Double = 12_000
	/// The wait after the first failed P2P attempt; it doubles with each further failure.
	public var p2pProbeIntervalMs: Double = 20_000
	/// The longest wait between P2P attempts while they keep failing (cellular behind a
	/// strict NAT, say): each attempt makes the desktop reload its capture page.
	public var p2pMaxProbeIntervalMs: Double = 300_000
	public var lanBudgetMs: Double = 1_500
	public var lanProbeIntervalMs: Double = 20_000
	/// How long to wait before opening a new standby behind P2P after the last one dropped.
	public var standbyRetryMs: Double = 5_000
	public var keepaliveIntervalMs: Double = 25_000
	public var requestTimeoutMs: Double = 30_000
	public var maxBackoffMs: Double = 30_000
	/// In the foreground, how often the round trip is measured: often enough that the figure
	/// is current whenever someone looks, for a request of under a kilobyte.
	public var rttSampleIntervalMs: Double = 2_000
	/// How long a request waits for a recovering connection to catch up.
	public var recoveryWaitMs: Double = 3_000
	public var now: () -> Double = WallClock.nowMs

	public init(desktop: DesktopRecord, link: LinkIdentity, createTransport: @escaping TransportFactory) {
		self.desktop = desktop
		self.link = link
		self.createTransport = createTransport
		if let relay = desktop.relayBaseUrl, !relay.isEmpty {
			p2pTarget = PairingURI.desktopViewerUrl(relayBaseUrl: relay, pairingId: desktop.pairingId, mobileSecret: desktop.mobileSecret)
		}
	}
}

/// One logical link to one desktop (port of `channel-manager.ts`). LAN endpoints
/// race first; the relay is the fallback. While on the relay a LAN probe runs
/// periodically and the link switches back silently. Once either is online, the
/// link upgrades to the WebRTC control channel in the foreground, as Android's
/// `DesktopLink` does (ADR-0135), but only with a desktop that captures its screen
/// on demand (ADR-0140). Behind P2P the LAN or relay link stays open as a standby, so a
/// dropped P2P link hands over without reconnecting. The event sequence lives here, so a
/// switch never replays or drops.
public final class ChannelManager {
	private final class Candidate {
		let channel: LinkChannel
		let connection: RemoteConnection
		var unsubscribe: (() -> Void)?
		/// Listens while this candidate is the active link, or the standby behind P2P.
		var watch: (() -> Void)?
		/// A latency probe is waiting on this connection; its answer no longer matters once
		/// the candidate is replaced.
		var probing = false
		init(channel: LinkChannel, connection: RemoteConnection) {
			self.channel = channel
			self.connection = connection
		}

		func dispose() {
			unsubscribe?()
			unsubscribe = nil
			unwatch()
		}

		func unwatch() {
			watch?()
			watch = nil
		}
	}

	public private(set) var snapshot: LinkSnapshot = .offline
	private var active: Candidate?
	/// The LAN or relay link kept open behind P2P, so a dropped P2P link hands over at once.
	/// The desktop sends only on the best link (P2P), so it costs no more than its keepalive.
	private var standby: Candidate?
	private var lanEndpoints: [String]
	public private(set) var sequence: Int
	private let listeners = Listeners<LinkSnapshot>()
	private let eventListeners = Listeners<RemoteEvent>()
	private let options: ChannelManagerOptions
	private var generation = 0
	private var running = false
	private var foreground = true
	private var attemptInFlight = false
	private var reconnectTimer: Task<Void, Never>?
	private var probeTimer: Task<Void, Never>?
	private var p2pTask: Task<Void, Never>?
	/// P2P attempts failed in a row since the last success, network change or return to the foreground.
	private var p2pFailures = 0
	private var standbyTimer: Task<Void, Never>?
	private var rttTimer: Task<Void, Never>?
	private var rttWindow = RttWindow()
	private var backoffMs: Double = 1_000
	private var reconnectAttempt = 0

	public init(options: ChannelManagerOptions) {
		self.options = options
		lanEndpoints = options.desktop.lanEndpoints
		sequence = options.desktop.lastEventSequence
	}

	@discardableResult
	public func subscribe(_ listener: @escaping (LinkSnapshot) -> Void) -> () -> Void { listeners.add(listener) }

	@discardableResult
	public func onEvent(_ listener: @escaping (RemoteEvent) -> Void) -> () -> Void { eventListeners.add(listener) }

	public var activeChannel: LinkChannel? { active?.channel }

	var activeConnectionState: RemoteConnectionState? { active?.connection.state }

	public func start() {
		guard !running else { return }
		running = true
		Task { await attempt() }
	}

	/// App came to the foreground, the network changed, or a background refresh woke the
	/// app: re-evaluate the best channel now. Foreground or not is `setForeground`'s to say,
	/// so a background refresh reconnects over the LAN or relay without opening P2P.
	public func refresh() {
		guard running else { return }
		clearReconnect()
		backoffMs = 1_000
		if snapshot.status == .online {
			if active?.channel == .relay { Task { await probeLan() } }
			if active?.channel != .p2p {
				p2pFailures = 0
				clearP2pProbe()
				launchP2pProbe()
			}
			return
		}
		Task { await attempt() }
	}

	/// The phone moved to another network (Wi-Fi to cellular, say). Sockets on the old one
	/// may be dead without knowing it until a keepalive fails, so open the best link on the
	/// new one now and switch over, keeping the old one until then. Behind P2P only the
	/// standby is rebuilt: ICE moves or gives up the P2P link on its own.
	public func networkChanged() {
		guard running else { return }
		clearReconnect()
		backoffMs = 1_000
		p2pFailures = 0
		guard snapshot.status == .online, let active else {
			Task { await attempt() }
			return
		}
		if active.channel == .p2p {
			clearStandby()
			scheduleStandby(afterMs: 0)
			return
		}
		clearP2pProbe()
		Task {
			await switchOver(from: active)
			launchP2pProbe()
		}
	}

	private func switchOver(from previous: Candidate) async {
		let current = generation
		var found = await raceLan(current)
		if found == nil, current == generation { found = await connectRelay(current) }
		guard let found else { return }
		guard current == generation, running, active === previous else {
			found.dispose()
			found.connection.close()
			return
		}
		adopt(found)
		if found.channel == .relay { scheduleProbe() }
	}

	/// In the background the P2P link closes at once, so the desktop stops its capture and
	/// frees the connection instead of waiting for ICE to time out; the link falls back to
	/// the LAN or relay, and upgrades again in the foreground.
	public func setForeground(_ value: Bool) {
		foreground = value
		if !value {
			clearProbe()
			clearP2pProbe()
			if let active, active.channel == .p2p { dropActive(active, reason: "background") }
		} else {
			if active?.channel == .relay { scheduleProbe() }
			p2pFailures = 0
			launchP2pProbe()
		}
	}

	public func stop() {
		running = false
		generation += 1
		clearReconnect()
		clearProbe()
		clearP2pProbe()
		stopRttSampling()
		clearStandby()
		let previous = active
		active = nil
		if let previous {
			previous.dispose()
			previous.connection.close()
		}
		publish(.offline)
	}

	public func request(_ method: RemoteRequestMethod, payload: JSONValue? = nil, sessionId: String? = nil) async throws -> JSONValue? {
		guard let active, snapshot.status == .online, snapshot.peerOnline else { throw LinkOfflineError() }
		// A sequence gap puts the connection into `recovering` until the desktop
		// replays the missing tail, which is typical right after a (re)connect.
		// The link is still up, so wait for the replay instead of failing.
		if active.connection.state == .recovering {
			_ = await waitForState(active.connection, .online, timeoutMs: options.recoveryWaitMs)
		}
		// Not taken as the latency: a request's round trip includes the desktop's work on it,
		// hundreds of milliseconds for a session list, which made the figure jump.
		return try await active.connection.request(method, payload: payload, sessionId: sessionId)
	}

	private func attempt() async {
		guard running, !attemptInFlight else { return }
		attemptInFlight = true
		defer { attemptInFlight = false }
		let current = generation
		var connecting = snapshot
		connecting.status = .connecting
		connecting.channel = nil
		connecting.reconnectAttempt = reconnectAttempt
		publish(connecting)
		let lan = await raceLan(current)
		if current != generation {
			lan?.dispose()
			return
		}
		if let lan {
			adopt(lan)
			return
		}
		let relay = await connectRelay(current)
		if current != generation {
			relay?.dispose()
			return
		}
		if let relay {
			adopt(relay)
			scheduleProbe()
			return
		}
		scheduleReconnect("unreachable")
	}

	private func adopt(_ candidate: Candidate) {
		let previous = active
		active = candidate
		backoffMs = 1_000
		reconnectAttempt = 0
		clearReconnect()
		if candidate.channel == .lan { clearProbe() }
		if let previous {
			if candidate.channel == .p2p, previous.channel != .p2p {
				keepAsStandby(previous)
			} else {
				retire(previous)
			}
		}
		if candidate === standby { standby = nil }
		candidate.unwatch()
		candidate.watch = candidate.connection.onEvent { [weak self, weak candidate] event in
			guard let self, let candidate, self.active === candidate else { return }
			switch event {
			case let .remoteEvent(remote):
				self.deliver(remote)
			case let .peerStatus(online):
				var next = self.snapshot
				next.peerOnline = online
				self.publish(next)
			case let .state(state):
				if state == .reconnecting || state == .failed || state == .closed {
					self.dropActive(candidate, reason: candidate.connection.snapshot.lastErrorCode?.rawValue ?? state.rawValue)
				} else if state == .online, self.snapshot.status != .online {
					var next = self.snapshot
					next.status = .online
					next.peerOnline = true
					self.publish(next)
				}
			case let .error(error):
				if error.code == .unauthorized {
					var next = self.snapshot
					next.lastError = "unauthorized"
					self.publish(next)
				}
			case .remoteRequest:
				break
			}
		}
		publish(LinkSnapshot(
			status: .online,
			channel: candidate.channel,
			rttMs: candidate.connection.snapshot.lastRttMs,
			peerOnline: true,
			desktop: snapshot.desktop,
			lastError: nil,
			reconnectAttempt: 0
		))
		startRttSampling()
		if candidate.channel != .p2p { launchP2pProbe() }
	}

	/// Lets a channel that a better one replaced finish the requests already sent on it,
	/// then closes it: the desktop may already have acted on them, so they cannot simply
	/// be sent again on the new channel.
	private func retire(_ candidate: Candidate) {
		candidate.dispose()
		Task {
			let deadline = options.now() + 10_000
			// A latency probe is not waited for: only its round trip mattered, and a desktop
			// slow to answer it would hold the old channel open for the full deadline.
			while candidate.connection.snapshot.pendingRequestCount > (candidate.probing ? 1 : 0), options.now() < deadline {
				try? await Task.sleep(nanoseconds: 50_000_000)
			}
			candidate.connection.close()
		}
	}

	/// Upgrades an established LAN or relay link to the WebRTC control channel, and keeps
	/// trying while it cannot, waiting twice as long after each failure up to
	/// `p2pMaxProbeIntervalMs`. Only in the foreground, and only
	/// with a desktop that captures on demand: an older one streams its screen for as long
	/// as the link is up (ADR-0140).
	private func launchP2pProbe() {
		guard running, foreground, let active, active.channel != .p2p, p2pTask == nil,
		      snapshot.desktop?.screen == true,
		      let factory = options.createP2pTransport, let target = options.p2pTarget else { return }
		let current = generation
		p2pTask = Task { [weak self] in
			guard let self else { return }
			let candidate = self.buildConnection(.p2p, transport: factory(target))
			let online = await self.waitOnline(candidate, timeoutMs: self.options.p2pTimeoutMs)
			if !Task.isCancelled, online, self.running, self.foreground, current == self.generation, self.active != nil, self.active?.channel != .p2p {
				self.p2pTask = nil
				self.p2pFailures = 0
				self.adopt(candidate)
				return
			}
			candidate.dispose()
			candidate.connection.close()
			guard !Task.isCancelled else { return }
			let delay = min(self.options.p2pProbeIntervalMs * pow(2, Double(self.p2pFailures)), self.options.p2pMaxProbeIntervalMs)
			self.p2pFailures += 1
			try? await Task.sleep(nanoseconds: UInt64(delay * 1_000_000))
			guard !Task.isCancelled else { return }
			self.p2pTask = nil
			self.launchP2pProbe()
		}
	}

	private func keepAsStandby(_ candidate: Candidate) {
		clearStandby()
		standby = candidate
		candidate.unwatch()
		candidate.watch = candidate.connection.onEvent { [weak self, weak candidate] event in
			guard let self, let candidate, self.standby === candidate, case let .state(state) = event,
			      state == .reconnecting || state == .failed || state == .closed else { return }
			self.standby = nil
			candidate.dispose()
			candidate.connection.close()
			self.scheduleStandby()
		}
	}

	/// The standby, if it is still up; one that is not is closed.
	private func takeStandby() -> Candidate? {
		standbyTimer?.cancel()
		standbyTimer = nil
		guard let candidate = standby else { return nil }
		standby = nil
		guard candidate.connection.state == .online else {
			candidate.dispose()
			candidate.connection.close()
			return nil
		}
		return candidate
	}

	/// Opens a new standby behind P2P a little later: the LAN if it answers, else the relay.
	private func scheduleStandby(afterMs delay: Double? = nil) {
		guard running, standbyTimer == nil else { return }
		let current = generation
		let delay = delay ?? options.standbyRetryMs
		standbyTimer = Task { [weak self] in
			if delay > 0 { try? await Task.sleep(nanoseconds: UInt64(delay * 1_000_000)) }
			guard !Task.isCancelled, let self else { return }
			var found = await self.raceLan(current)
			if found == nil, !Task.isCancelled, current == self.generation { found = await self.connectRelay(current) }
			self.standbyTimer = nil
			guard let found else {
				if !Task.isCancelled, current == self.generation, self.active?.channel == .p2p { self.scheduleStandby() }
				return
			}
			guard !Task.isCancelled, current == self.generation, self.running, self.active?.channel == .p2p, self.standby == nil else {
				found.dispose()
				found.connection.close()
				return
			}
			self.keepAsStandby(found)
		}
	}

	private func clearStandby() {
		standbyTimer?.cancel()
		standbyTimer = nil
		let previous = standby
		standby = nil
		if let previous {
			previous.dispose()
			previous.connection.close()
		}
	}

	private func clearP2pProbe() {
		p2pTask?.cancel()
		p2pTask = nil
	}

	private func dropActive(_ candidate: Candidate, reason: String) {
		guard active === candidate else { return }
		active = nil
		clearP2pProbe()
		stopRttSampling()
		candidate.dispose()
		candidate.connection.close()
		// P2P is only an upgrade over a LAN or relay that most likely still works: fall back
		// at once instead of showing the desktop offline and waiting out a backoff.
		if candidate.channel == .p2p, let standby = takeStandby() {
			// Events the desktop sent over P2P as it died never arrived: catch up on the standby.
			standby.connection.resume(after: sequence)
			adopt(standby)
			return
		}
		if candidate.channel == .p2p {
			clearStandby()
			var next = snapshot
			next.status = .connecting
			next.channel = nil
			next.peerOnline = false
			publish(next)
			Task { await attempt() }
			return
		}
		var next = snapshot
		next.status = .offline
		next.channel = nil
		next.peerOnline = false
		next.lastError = reason
		publish(next)
		clearProbe()
		scheduleReconnect(reason)
	}

	private func deliver(_ event: RemoteEvent) {
		if event.name != .sessionResync, event.sequence <= sequence { return }
		sequence = event.sequence
		options.onSequence?(event.sequence)
		if event.name == .deviceStatus, let status = RemoteAPI.readDeviceStatus(event.payload) {
			if !status.lanEndpoints.isEmpty, status.lanEndpoints != lanEndpoints {
				lanEndpoints = status.lanEndpoints
				options.onLanEndpoints?(status.lanEndpoints)
			}
			var next = snapshot
			next.desktop = status
			publish(next)
			launchP2pProbe()
		}
		eventListeners.emit(event)
	}

	private func buildConnection(_ channel: LinkChannel, url: String) -> Candidate {
		buildConnection(channel, transport: options.createTransport(url, TransportOptions(
			pairingSecret: options.desktop.mobileSecret,
			keepaliveIntervalMs: options.keepaliveIntervalMs
		)))
	}

	private func buildConnection(_ channel: LinkChannel, transport: RemoteTransport) -> Candidate {
		var connectionOptions = RemoteConnectionOptions(
			role: .mobile,
			deviceId: options.link.deviceId,
			deviceName: options.link.deviceName,
			// `screen`: the desktop captures only while the remote screen is open (ADR-0140).
			capabilities: RemoteCapabilities(chat: true, sessionRead: true, screen: true),
			identity: options.link.identity
		)
		connectionOptions.expectedPeerIdentityKey = try? RemoteCrypto.decodePublicKey(options.desktop.desktopIdentityKey)
		connectionOptions.resumeFrom = sequence
		connectionOptions.requestTimeoutMs = options.requestTimeoutMs
		connectionOptions.now = options.now
		let candidate = Candidate(channel: channel, connection: RemoteConnection(transport: transport, options: connectionOptions))
		// Events that arrive during the race (before adoption) must not be lost:
		// the desktop replays from `resumeFrom` right after the handshake.
		candidate.unsubscribe = candidate.connection.onEvent { [weak self, weak candidate] event in
			guard let self, let candidate, self.active !== candidate else { return }
			if case let .remoteEvent(remote) = event { self.deliver(remote) }
		}
		return candidate
	}

	private func waitForState(_ connection: RemoteConnection, _ target: RemoteConnectionState, timeoutMs: Double) async -> Bool {
		if connection.state == target { return true }
		return await withCheckedContinuation { continuation in
			var settled = false
			var off: (() -> Void)?
			var timer: Task<Void, Never>?
			let finish = { (value: Bool) in
				if settled { return }
				settled = true
				timer?.cancel()
				off?()
				continuation.resume(returning: value)
			}
			off = connection.onEvent { event in
				if case let .state(state) = event, state == target || state == .closed || state == .failed || state == .reconnecting {
					finish(state == target)
				}
			}
			timer = schedule(after: timeoutMs) { finish(connection.state == target) }
		}
	}

	private func waitOnline(_ candidate: Candidate, timeoutMs: Double) async -> Bool {
		await withCheckedContinuation { continuation in
			var settled = false
			var off: (() -> Void)?
			var timer: Task<Void, Never>?
			let finish = { (value: Bool) in
				if settled { return }
				settled = true
				timer?.cancel()
				off?()
				continuation.resume(returning: value)
			}
			off = candidate.connection.onEvent { [weak self] event in
				switch event {
				case .state(.online): finish(true)
				case .state(.failed), .state(.reconnecting): finish(false)
				case let .error(error) where error.code == .unauthorized:
					if let self {
						var next = self.snapshot
						next.lastError = "unauthorized"
						self.publish(next)
					}
					finish(false)
				default: break
				}
			}
			timer = schedule(after: timeoutMs) { finish(false) }
			Task {
				do { try await candidate.connection.connect() } catch { finish(false) }
			}
		}
	}

	private func raceLan(_ current: Int) async -> Candidate? {
		guard !lanEndpoints.isEmpty else { return nil }
		let candidates = lanEndpoints.map {
			buildConnection(.lan, url: PairingURI.lanControlUrl(endpoint: $0, pairingId: options.desktop.pairingId))
		}
		let winner: Candidate? = await withCheckedContinuation { continuation in
			var remaining = candidates.count
			var done = false
			for candidate in candidates {
				Task {
					let online = await self.waitOnline(candidate, timeoutMs: self.options.lanBudgetMs)
					if done { return }
					if online {
						done = true
						continuation.resume(returning: candidate)
						return
					}
					remaining -= 1
					if remaining == 0 {
						done = true
						continuation.resume(returning: nil)
					}
				}
			}
		}
		for candidate in candidates where !(candidate === winner && current == generation) {
			candidate.dispose()
			candidate.connection.close()
		}
		return winner
	}

	private func connectRelay(_ current: Int) async -> Candidate? {
		guard let relay = options.desktop.relayBaseUrl, !relay.isEmpty else { return nil }
		let candidate = buildConnection(.relay, url: PairingURI.relayControlUrl(relayBaseUrl: relay, pairingId: options.desktop.pairingId, role: .mobile))
		let online = await waitOnline(candidate, timeoutMs: max(options.lanBudgetMs * 4, 8_000))
		if !online || current != generation {
			candidate.dispose()
			candidate.connection.close()
			return nil
		}
		return candidate
	}

	private func scheduleProbe() {
		clearProbe()
		guard foreground, running else { return }
		probeTimer = schedule(after: options.lanProbeIntervalMs) { [weak self] in
			self?.probeTimer = nil
			Task { await self?.probeLan() }
		}
	}

	private func probeLan() async {
		guard running, active?.channel == .relay else { return }
		let current = generation
		let lan = await raceLan(current)
		if current != generation || !running {
			lan?.dispose()
			return
		}
		if let lan, active?.channel == .relay {
			adopt(lan)
			return
		}
		if let lan {
			lan.dispose()
			lan.connection.close()
		}
		if active?.channel == .relay { scheduleProbe() }
	}

	private func scheduleReconnect(_ reason: String) {
		guard running, reconnectTimer == nil else { return }
		reconnectAttempt += 1
		let delay = backoffMs
		backoffMs = min(options.maxBackoffMs, backoffMs * 2)
		var next = snapshot
		next.status = .offline
		next.channel = nil
		next.peerOnline = false
		next.lastError = reason
		next.reconnectAttempt = reconnectAttempt
		publish(next)
		reconnectTimer = schedule(after: delay) { [weak self] in
			self?.reconnectTimer = nil
			Task { await self?.attempt() }
		}
	}

	private func clearReconnect() {
		reconnectTimer?.cancel()
		reconnectTimer = nil
	}

	private func clearProbe() {
		probeTimer?.cancel()
		probeTimer = nil
	}

	/// Measures every interval. A new channel starts a new window: its route, and so its
	/// latency, differs.
	private func startRttSampling() {
		stopRttSampling()
		rttWindow.clear()
		rttTimer = Task { [weak self] in
			while !Task.isCancelled {
				guard let interval = self?.options.rttSampleIntervalMs else { return }
				try? await Task.sleep(nanoseconds: UInt64(interval * 1_000_000))
				guard !Task.isCancelled, let self else { return }
				await self.sampleRtt()
			}
		}
	}

	/// One `diagnostics.snapshot`, which the desktop answers from memory, so its round trip
	/// is the link's own.
	private func sampleRtt() async {
		guard let active, snapshot.isUsable, foreground else { return }
		let startedAt = options.now()
		active.probing = true
		defer { active.probing = false }
		guard (try? await active.connection.request(.diagnosticsSnapshot)) != nil,
		      !Task.isCancelled, self.active === active else { return }
		var next = snapshot
		next.rttMs = rttWindow.add(max(0, options.now() - startedAt))
		publish(next)
	}

	private func stopRttSampling() {
		rttTimer?.cancel()
		rttTimer = nil
	}

	private func publish(_ next: LinkSnapshot) {
		snapshot = next
		listeners.emit(next)
	}
}
