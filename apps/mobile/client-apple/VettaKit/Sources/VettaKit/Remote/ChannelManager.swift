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
	public var p2pProbeIntervalMs: Double = 20_000
	public var lanBudgetMs: Double = 1_500
	public var lanProbeIntervalMs: Double = 20_000
	public var keepaliveIntervalMs: Double = 25_000
	public var requestTimeoutMs: Double = 30_000
	public var maxBackoffMs: Double = 30_000
	public var rttSampleIntervalMs: Double = 30_000
	/// How long a request waits for a recovering connection to catch up.
	public var recoveryWaitMs: Double = 3_000
	public var now: () -> Double = WallClock.nowMs

	public init(desktop: DesktopRecord, link: LinkIdentity, createTransport: @escaping TransportFactory) {
		self.desktop = desktop
		self.link = link
		self.createTransport = createTransport
	}
}

/// One logical link to one desktop (port of `channel-manager.ts`). LAN endpoints
/// race first; the relay is the fallback. While on the relay a LAN probe runs
/// periodically and the link switches back silently. Once either is online, the
/// link upgrades to the WebRTC control channel in the foreground, as Android's
/// `DesktopLink` does (ADR-0135), but only with a desktop that captures its screen
/// on demand (ADR-0140). The event sequence lives here, so a switch never replays
/// or drops.
public final class ChannelManager {
	private final class Candidate {
		let channel: LinkChannel
		let connection: RemoteConnection
		var unsubscribe: (() -> Void)?
		init(channel: LinkChannel, connection: RemoteConnection) {
			self.channel = channel
			self.connection = connection
		}

		func dispose() {
			unsubscribe?()
			unsubscribe = nil
		}
	}

	public private(set) var snapshot: LinkSnapshot = .offline
	private var active: Candidate?
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
	private var rttTimer: Task<Void, Never>?
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
				clearP2pProbe()
				launchP2pProbe()
			}
			return
		}
		Task { await attempt() }
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
		let result = try await active.connection.request(method, payload: payload, sessionId: sessionId)
		var next = snapshot
		next.rttMs = active.connection.snapshot.lastRttMs
		publish(next)
		return result
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
		if let previous { retire(previous) }
		candidate.connection.onEvent { [weak self, weak candidate] event in
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
			while candidate.connection.snapshot.pendingRequestCount > 0, options.now() < deadline {
				try? await Task.sleep(nanoseconds: 50_000_000)
			}
			candidate.connection.close()
		}
	}

	/// Upgrades an established LAN or relay link to the WebRTC control channel, and keeps
	/// trying every `p2pProbeIntervalMs` while it cannot. Only in the foreground, and only
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
				self.adopt(candidate)
				return
			}
			candidate.dispose()
			candidate.connection.close()
			guard !Task.isCancelled else { return }
			try? await Task.sleep(nanoseconds: UInt64(self.options.p2pProbeIntervalMs * 1_000_000))
			guard !Task.isCancelled else { return }
			self.p2pTask = nil
			self.launchP2pProbe()
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

	private func startRttSampling() {
		stopRttSampling()
		rttTimer = Task { [weak self] in
			while !Task.isCancelled {
				let interval = self?.options.rttSampleIntervalMs ?? 30_000
				try? await Task.sleep(nanoseconds: UInt64(interval * 1_000_000))
				guard !Task.isCancelled, let self else { return }
				guard let active = self.active, self.snapshot.isUsable, self.foreground else { continue }
				if (try? await active.connection.request(.diagnosticsSnapshot)) != nil {
					var next = self.snapshot
					next.rttMs = active.connection.snapshot.lastRttMs
					self.publish(next)
				}
			}
		}
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
