import Foundation

public enum RemoteConnectionEvent {
	case state(RemoteConnectionState)
	case remoteRequest(RemoteRequest)
	case remoteEvent(RemoteEvent)
	case peerStatus(online: Bool)
	case error(RemoteError)
}

public enum RemoteHelloDecision {
	case approve
	/// Ask the person at the acceptor to compare the verification code first.
	case pending(approval: () async -> Bool)
	case reject(reason: String)
}

public struct RemoteConnectionSnapshot: Equatable {
	public var state: RemoteConnectionState
	public var deviceId: String
	public var connectionId: String
	public var peerDeviceId: String?
	public var peerIdentityKey: String?
	/// Six-digit code both ends can display to confirm a manual pairing.
	public var verificationCode: String?
	public var lastEventSequence: Int
	public var lastAckSequence: Int
	public var pendingRequestCount: Int
	public var reconnectCount: Int
	public var lastRttMs: Double?
	public var lastErrorCode: RemoteErrorCode?
}

public struct RemoteConnectionOptions {
	public var role: RemoteRole
	public var deviceId: String
	public var deviceName: String
	public var capabilities: RemoteCapabilities
	public var identity: RemoteIdentityKeyPair
	/// `initiate` sends `hello`; `accept` waits for the peer's `hello` (the desktop LAN server).
	public var handshake: Handshake = .initiate
	/// Pinned peer identity; a peer presenting another key is rejected before any secret is derived.
	public var expectedPeerIdentityKey: Data?
	/// Acceptor-only hook that decides whether an unknown peer may pair.
	public var onHello: ((RemoteHello) async -> RemoteHelloDecision)?
	/// Shared outbound journal so events survive a channel switch.
	public var journal: RemoteEventJournal?
	/// Highest event sequence already received from this peer.
	public var resumeFrom: Int = 0
	public var connectionId: String?
	public var requestTimeoutMs: Double = 30_000
	public var now: () -> Double = WallClock.nowMs
	public var randomBytes: RandomBytes = RemoteCrypto.randomBytes

	public enum Handshake { case initiate, accept }

	public init(role: RemoteRole, deviceId: String, deviceName: String, capabilities: RemoteCapabilities, identity: RemoteIdentityKeyPair) {
		self.role = role
		self.deviceId = deviceId
		self.deviceName = deviceName
		self.capabilities = capabilities
		self.identity = identity
	}
}

public struct RemoteRequestError: Error, LocalizedError, Equatable {
	public let message: String
	public init(_ message: String) { self.message = message }
	public var errorDescription: String? { message }
}

/// One end of a remote link over one transport (port of `connection.ts`). Handles
/// the plaintext handshake, derives the session keys, seals everything after
/// that, correlates requests and keeps the inbound event sequence continuous.
public final class RemoteConnection {
	private struct PendingRequest {
		let continuation: CheckedContinuation<JSONValue?, Error>
		let startedAt: Double
		let timeout: Task<Void, Never>
	}

	private static let earlySealedLimit = 32

	public private(set) var state: RemoteConnectionState = .idle
	private let transport: RemoteTransport
	private let options: RemoteConnectionOptions
	private let connectionId: String
	private let journal: RemoteEventJournal
	private var pending: [String: PendingRequest] = [:]
	private let listeners = Listeners<RemoteConnectionEvent>()
	private var ephemeral: RemoteIdentityKeyPair?
	private var keys: RemoteSessionKeys?
	private var peerDeviceId: String?
	private var peerIdentityKey: Data?
	private var lastEventSequence: Int
	private var lastAckSequence = 0
	private var reconnectCount = 0
	private var lastRttMs: Double?
	private var lastErrorCode: RemoteErrorCode?
	private var requestCounter = 0
	/// Sealed frames that overtook our own `hello_ack` on a relay; held instead of failing.
	private var earlySealed: [RemoteSealed] = []

	public init(transport: RemoteTransport, options: RemoteConnectionOptions) {
		self.transport = transport
		self.options = options
		connectionId = options.connectionId ?? "conn-\(options.deviceId)-\(RemoteConnection.shortRandom())"
		journal = options.journal ?? RemoteEventJournal(now: options.now)
		lastEventSequence = options.resumeFrom
	}

	private static func shortRandom() -> String {
		let alphabet = Array("abcdefghijklmnopqrstuvwxyz0123456789")
		return String((0 ..< 8).map { _ in alphabet.randomElement()! })
	}

	@discardableResult
	public func onEvent(_ listener: @escaping (RemoteConnectionEvent) -> Void) -> () -> Void {
		listeners.add(listener)
	}

	public var snapshot: RemoteConnectionSnapshot {
		RemoteConnectionSnapshot(
			state: state,
			deviceId: options.deviceId,
			connectionId: connectionId,
			peerDeviceId: peerDeviceId,
			peerIdentityKey: peerIdentityKey.map(Base64URL.encode),
			verificationCode: peerIdentityKey.map { RemoteCrypto.verificationCode(options.identity.publicKey, $0) },
			lastEventSequence: lastEventSequence,
			lastAckSequence: lastAckSequence,
			pendingRequestCount: pending.count,
			reconnectCount: reconnectCount,
			lastRttMs: lastRttMs,
			lastErrorCode: lastErrorCode
		)
	}

	public func connect() async throws {
		if state == .online || state == .connecting || state == .pendingApproval { return }
		setState(state == .idle ? .connecting : .reconnecting)
		ephemeral = RemoteIdentityKeyPair.generate(randomBytes: options.randomBytes)
		keys = nil
		earlySealed.removeAll()
		do {
			try await transport.connect(RemoteTransportHandlers(
				onFrame: { [weak self] frame in self?.handleFrame(frame) },
				onClose: { [weak self] reason in self?.handleClose(reason) }
			))
			if options.handshake == .initiate { try transport.send(buildHello()) }
		} catch {
			setState(.failed)
			throw error
		}
	}

	public func close() {
		if state == .closed { return }
		rejectPending("remote connection closed")
		setState(.closed)
		keys = nil
		transport.close(reason: nil)
	}

	public func request(_ method: RemoteRequestMethod, payload: JSONValue? = nil, sessionId: String? = nil) async throws -> JSONValue? {
		guard state == .online else { throw RemoteRequestError("remote connection is \(state.rawValue)") }
		let requestId = "\(connectionId)-\(Int64(options.now()))-\(requestCounter)"
		requestCounter += 1
		let request = RemoteRequest(requestId: requestId, method: method, sessionId: sessionId, payload: payload)
		return try await withCheckedThrowingContinuation { continuation in
			let timeout = schedule(after: options.requestTimeoutMs) { [weak self] in
				guard let self, let entry = self.pending.removeValue(forKey: requestId) else { return }
				let message = "remote request timed out: \(method.rawValue)"
				self.lastErrorCode = .requestTimeout
				self.emit(.error(RemoteError(code: .requestTimeout, message: message, retryable: true)))
				entry.continuation.resume(throwing: RemoteRequestError(message))
			}
			pending[requestId] = PendingRequest(continuation: continuation, startedAt: options.now(), timeout: timeout)
			do {
				try sendSealed(.request(request))
			} catch {
				timeout.cancel()
				pending.removeValue(forKey: requestId)
				continuation.resume(throwing: error)
			}
		}
	}

	public func respond(requestId: String, success: Bool, payload: JSONValue? = nil, error: RemoteError? = nil) throws {
		guard state == .online else { throw RemoteRequestError("remote connection is \(state.rawValue)") }
		try sendSealed(.response(RemoteResponse(requestId: requestId, success: success, payload: payload, error: error)))
	}

	/// Records the event in the journal and delivers it when online.
	@discardableResult
	public func emitEvent(_ name: RemoteEventName, payload: JSONValue? = nil, sessionId: String? = nil) throws -> RemoteEvent {
		let sequence = journal.nextSequence()
		let event = RemoteEvent(eventId: "\(options.deviceId)-event-\(sequence)", sequence: sequence, name: name, sessionId: sessionId, payload: payload)
		journal.remember(event)
		if state == .online { try sendSealed(.event(event)) }
		return event
	}

	private func buildHello() -> RemoteFrame {
		.hello(RemoteHello(
			role: options.role,
			deviceId: options.deviceId,
			deviceName: options.deviceName,
			capabilities: options.capabilities,
			connectionId: connectionId,
			identityKey: Base64URL.encode(options.identity.publicKey),
			ephemeralKey: Base64URL.encode(ephemeral!.publicKey)
		))
	}

	private func handleFrame(_ frame: RemoteFrame) {
		switch frame {
		case let .hello(hello):
			if options.handshake == .accept, state != .online {
				Task { await self.handleInboundHello(hello) }
			} else {
				protocolViolation("unexpected hello")
			}
		case let .helloAck(ack):
			if options.handshake == .initiate { handleHelloAck(ack) } else { protocolViolation("unexpected hello_ack") }
		case let .pairingPending(frame):
			if options.handshake == .initiate { handlePairingPending(frame) } else { protocolViolation("unexpected pairing_pending") }
		case let .peerStatus(online):
			if !online { rejectPending("remote peer is offline") }
			emit(.peerStatus(online: online))
		case let .sealed(sealed):
			guard keys != nil else {
				if options.handshake == .initiate, isHandshaking, earlySealed.count < Self.earlySealedLimit {
					earlySealed.append(sealed)
					return
				}
				protocolViolation("sealed frame before handshake")
				return
			}
			openSealed(sealed)
		default:
			protocolViolation("plaintext \(frame.typeName) frame")
		}
	}

	private func handleInboundHello(_ hello: RemoteHello) async {
		guard let peerKey = try? RemoteCrypto.decodePublicKey(hello.identityKey, field: "identityKey") else {
			protocolViolation("hello identity key is invalid")
			return
		}
		if let expected = options.expectedPeerIdentityKey, !RemoteCrypto.bytesEqual(expected, peerKey) {
			fail(.unauthorized, "peer identity does not match the pinned key")
			return
		}
		peerIdentityKey = peerKey
		peerDeviceId = hello.deviceId
		let decision: RemoteHelloDecision
		if let onHello = options.onHello {
			decision = await onHello(hello)
		} else {
			decision = options.expectedPeerIdentityKey != nil ? .approve : .reject(reason: "peer is not paired")
		}
		if state == .closed { return }
		switch decision {
		case let .reject(reason):
			fail(.unauthorized, reason)
			return
		case let .pending(approval):
			setState(.pendingApproval)
			do {
				try transport.send(.pairingPending(RemotePairingPending(
					connectionId: hello.connectionId,
					peerDeviceId: options.deviceId,
					peerIdentityKey: Base64URL.encode(options.identity.publicKey)
				)))
			} catch {
				return
			}
			let approved = await approval()
			if state != .pendingApproval { return }
			if !approved {
				fail(.approvalRejected, "pairing was not approved")
				return
			}
		case .approve:
			break
		}
		guard let ephemeral else { return }
		do {
			keys = try RemoteCrypto.deriveSessionKeys(
				role: options.role,
				identity: options.identity,
				ephemeral: ephemeral,
				peerIdentityKey: peerKey,
				peerEphemeralKey: try RemoteCrypto.decodePublicKey(hello.ephemeralKey, field: "ephemeralKey")
			)
			try transport.send(.helloAck(RemoteHelloAck(
				connectionId: hello.connectionId,
				peerDeviceId: options.deviceId,
				peerIdentityKey: Base64URL.encode(options.identity.publicKey),
				peerEphemeralKey: Base64URL.encode(ephemeral.publicKey)
			)))
		} catch {
			protocolViolation(describe(error))
			return
		}
		goOnline()
	}

	private func handleHelloAck(_ frame: RemoteHelloAck) {
		// A stale acknowledgement from an earlier attempt must not make this transport appear online.
		guard frame.connectionId == connectionId else { return }
		guard let ephemeral else { return }
		guard let peerKey = try? RemoteCrypto.decodePublicKey(frame.peerIdentityKey, field: "peerIdentityKey") else {
			protocolViolation("hello_ack identity key is invalid")
			return
		}
		if let expected = options.expectedPeerIdentityKey, !RemoteCrypto.bytesEqual(expected, peerKey) {
			fail(.unauthorized, "peer identity does not match the pinned key")
			return
		}
		do {
			keys = try RemoteCrypto.deriveSessionKeys(
				role: options.role,
				identity: options.identity,
				ephemeral: ephemeral,
				peerIdentityKey: peerKey,
				peerEphemeralKey: try RemoteCrypto.decodePublicKey(frame.peerEphemeralKey, field: "peerEphemeralKey")
			)
		} catch {
			protocolViolation(describe(error))
			return
		}
		peerIdentityKey = peerKey
		peerDeviceId = frame.peerDeviceId
		goOnline()
	}

	private func handlePairingPending(_ frame: RemotePairingPending) {
		guard frame.connectionId == connectionId else { return }
		guard let peerKey = try? RemoteCrypto.decodePublicKey(frame.peerIdentityKey, field: "peerIdentityKey") else {
			protocolViolation("pairing_pending identity key is invalid")
			return
		}
		peerIdentityKey = peerKey
		if let expected = options.expectedPeerIdentityKey, !RemoteCrypto.bytesEqual(expected, peerKey) {
			fail(.unauthorized, "peer identity does not match the pinned key")
			return
		}
		peerDeviceId = frame.peerDeviceId
		setState(.pendingApproval)
	}

	private var isHandshaking: Bool {
		state == .connecting || state == .reconnecting || state == .pendingApproval
	}

	private func openSealed(_ sealed: RemoteSealed) {
		guard let keys else { return }
		let inner: RemoteFrame
		do {
			inner = try RemoteCrypto.openFrame(key: keys.receiveKey, sealed: sealed)
		} catch {
			protocolViolation(describe(error))
			return
		}
		handleSessionFrame(inner)
	}

	private func goOnline() {
		setState(.online)
		let early = earlySealed
		earlySealed.removeAll()
		for sealed in early {
			if state != .online { return }
			openSealed(sealed)
		}
		// Tell the peer what we already hold so it replays only the missing tail.
		try? sendSealed(.resume(lastEventSequence: lastEventSequence))
	}

	private func handleSessionFrame(_ frame: RemoteFrame) {
		switch frame {
		case let .request(request):
			emit(.remoteRequest(request))
		case let .response(response):
			handleResponse(response)
		case let .event(event):
			handleEvent(event)
		case let .ack(sequence):
			lastAckSequence = max(lastAckSequence, sequence)
			journal.acknowledge(sequence)
		case let .resume(lastEventSequence):
			replay(after: lastEventSequence)
		default:
			break
		}
	}

	private func replay(after sequence: Int) {
		guard let events = journal.replay(after: sequence) else {
			// The tail was evicted; the peer must reload state instead.
			_ = try? emitEvent(.sessionResync)
			return
		}
		for event in events {
			do { try sendSealed(.event(event)) } catch { return }
		}
	}

	private func handleResponse(_ frame: RemoteResponse) {
		guard let entry = pending.removeValue(forKey: frame.requestId) else { return }
		entry.timeout.cancel()
		lastRttMs = max(0, options.now() - entry.startedAt)
		if frame.success {
			entry.continuation.resume(returning: frame.payload)
		} else {
			lastErrorCode = frame.error?.code ?? .internalError
			let message = frame.error?.message ?? "remote request failed"
			emit(.error(frame.error ?? RemoteError(code: .internalError, message: message, retryable: false)))
			entry.continuation.resume(throwing: RemoteRequestError(message))
		}
	}

	private func handleEvent(_ event: RemoteEvent) {
		if event.name == .sessionResync {
			// An explicit reset: adopt the peer's sequence and let the application reload.
			lastEventSequence = event.sequence
			if state == .recovering { setState(.online) }
			emit(.remoteEvent(event))
			acknowledge(event.sequence)
			return
		}
		if event.sequence <= lastEventSequence { return }
		if event.sequence != lastEventSequence + 1 {
			lastErrorCode = .transportClosed
			setState(.recovering)
			try? sendSealed(.resume(lastEventSequence: lastEventSequence))
			return
		}
		lastEventSequence = event.sequence
		if state == .recovering { setState(.online) }
		emit(.remoteEvent(event))
		acknowledge(event.sequence)
	}

	private func acknowledge(_ sequence: Int) {
		try? sendSealed(.ack(sequence: sequence))
	}

	private func sendSealed(_ frame: RemoteFrame) throws {
		guard let keys else { throw RemoteRequestError("remote connection has no session keys") }
		try transport.send(.sealed(RemoteCrypto.sealFrame(key: keys.sendKey, frame: frame, randomBytes: options.randomBytes)))
	}

	private func protocolViolation(_ reason: String) {
		fail(.invalidFrame, reason)
	}

	private func fail(_ code: RemoteErrorCode, _ message: String) {
		lastErrorCode = code
		emit(.error(RemoteError(code: code, message: message, retryable: code == .invalidFrame)))
		rejectPending(message)
		keys = nil
		setState(.failed)
		transport.close(reason: message)
	}

	private func handleClose(_ reason: String?) {
		if state == .closed { return }
		reconnectCount += 1
		keys = nil
		rejectPending("remote transport closed")
		if state != .failed { setState(.reconnecting) }
	}

	private func rejectPending(_ message: String) {
		if !pending.isEmpty { lastErrorCode = .transportClosed }
		let entries = pending.values
		pending.removeAll()
		for entry in entries {
			entry.timeout.cancel()
			entry.continuation.resume(throwing: RemoteRequestError(message))
		}
	}

	private func setState(_ next: RemoteConnectionState) {
		if state == next { return }
		state = next
		emit(.state(next))
	}

	private func emit(_ event: RemoteConnectionEvent) {
		listeners.emit(event)
	}

	private func describe(_ error: Error) -> String {
		if let error = error as? RemoteProtocolError { return error.message }
		return (error as? LocalizedError)?.errorDescription ?? String(describing: error)
	}
}
