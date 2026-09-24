import Foundation

public enum PairingFailure: String, Sendable {
	case invalidCode = "invalid_code"
	case rejected
	case unauthorized
	case unreachable
	case invalidEndpoint = "invalid_endpoint"
}

public enum PairingVia: String, Sendable {
	case lan, relay, manual
}

public enum PairingPhase: Equatable, Sendable {
	case idle
	case connecting(via: PairingVia)
	case awaitingApproval(verificationCode: String, desktopName: String?)
	case paired(DesktopRecord)
	case failed(PairingFailure)

	public var isConnecting: Bool {
		if case .connecting = self { return true }
		return false
	}
}

public struct PairingFlowOptions {
	public var link: LinkIdentity
	public var createTransport: TransportFactory
	public var onPhase: (PairingPhase) -> Void
	public var timeoutMs: Double = 4_000
	public var approvalTimeoutMs: Double = 120_000
	public var now: () -> Double = WallClock.nowMs

	public init(link: LinkIdentity, createTransport: @escaping TransportFactory, onPhase: @escaping (PairingPhase) -> Void) {
		self.link = link
		self.createTransport = createTransport
		self.onPhase = onPhase
	}
}

/// Turns a scanned QR code or a typed `host:port` into a desktop record (port of
/// `pairing-flow.ts`). Both paths end with a connection that reached `online`
/// against the desktop's pinned identity key; the manual path additionally waits
/// for the desktop to hand over the long-lived credential.
public final class PairingFlow {
	public static let manualPairingPath = "/v2/lan/pair"

	private enum Outcome {
		case online(RemoteConnection)
		case failed(PairingFailure)
	}

	private var cancelled = false
	private var connections: [RemoteConnection] = []
	private let options: PairingFlowOptions

	public init(options: PairingFlowOptions) {
		self.options = options
	}

	public func cancel() {
		cancelled = true
		let open = connections
		connections.removeAll()
		for connection in open { connection.close() }
	}

	public func pairWithCode(_ text: String) async -> DesktopRecord? {
		let invite: RemotePairingInvite
		do {
			invite = try PairingURI.parse(text)
		} catch {
			fail(.invalidCode)
			return nil
		}
		var attempts: [(via: PairingVia, url: String)] = invite.lanEndpoints.map {
			(.lan, PairingURI.lanControlUrl(endpoint: $0, pairingId: invite.pairingId))
		}
		if let relay = invite.relayBaseUrl {
			attempts.append((.relay, PairingURI.relayControlUrl(relayBaseUrl: relay, pairingId: invite.pairingId, role: .mobile)))
		}
		if attempts.isEmpty {
			fail(.invalidCode)
			return nil
		}
		let expected = try? RemoteCrypto.decodePublicKey(invite.desktopIdentityKey)
		var lastFailure = PairingFailure.unreachable
		attempts: for attempt in attempts {
			if cancelled { return nil }
			options.onPhase(.connecting(via: attempt.via))
			let outcome = await connectOnce(
				url: attempt.url,
				transport: TransportOptions(pairingSecret: invite.mobileSecret),
				expectedPeerIdentityKey: expected,
				timeoutMs: attempt.via == .lan ? options.timeoutMs : max(options.timeoutMs, 8_000),
				approvalTimeoutMs: options.approvalTimeoutMs
			)
			switch outcome {
			case let .online(connection):
				let now = options.now()
				let record = DesktopRecord(
					desktopIdentityKey: invite.desktopIdentityKey,
					desktopName: invite.desktopName,
					pairingId: invite.pairingId,
					mobileSecret: invite.mobileSecret,
					lanEndpoints: invite.lanEndpoints,
					relayBaseUrl: invite.relayBaseUrl,
					lastEventSequence: 0,
					pairedAt: now,
					lastSeenAt: now
				)
				connection.close()
				options.onPhase(.paired(record))
				return record
			case let .failed(reason):
				lastFailure = reason
				if reason == .unauthorized || reason == .rejected { break attempts }
			}
		}
		fail(lastFailure)
		return nil
	}

	public func pairManually(_ endpoint: String) async -> DesktopRecord? {
		let trimmed = endpoint.trimmingCharacters(in: .whitespacesAndNewlines)
		guard PairingURI.isValidHostPort(trimmed) else {
			fail(.invalidEndpoint)
			return nil
		}
		options.onPhase(.connecting(via: .manual))
		let outcome = await connectOnce(
			url: "ws://\(trimmed)\(Self.manualPairingPath)",
			transport: TransportOptions(manual: true),
			expectedPeerIdentityKey: nil,
			timeoutMs: options.timeoutMs,
			approvalTimeoutMs: options.approvalTimeoutMs
		)
		guard case let .online(connection) = outcome else {
			if case let .failed(reason) = outcome { fail(reason) }
			return nil
		}
		let paired = await waitForPaired(connection, timeoutMs: options.approvalTimeoutMs)
		connection.close()
		guard let paired, let peerKey = connection.snapshot.peerIdentityKey else {
			fail(.unreachable)
			return nil
		}
		let now = options.now()
		let record = DesktopRecord(
			desktopIdentityKey: peerKey,
			desktopName: paired.desktopName,
			pairingId: paired.pairingId,
			mobileSecret: paired.mobileSecret,
			lanEndpoints: paired.lanEndpoints.isEmpty ? [trimmed] : paired.lanEndpoints,
			relayBaseUrl: paired.relayBaseUrl,
			lastEventSequence: 0,
			pairedAt: now,
			lastSeenAt: now
		)
		options.onPhase(.paired(record))
		return record
	}

	private func connectOnce(url: String, transport transportOptions: TransportOptions, expectedPeerIdentityKey: Data?, timeoutMs: Double, approvalTimeoutMs: Double) async -> Outcome {
		let transport = CloseReasonTransport(inner: options.createTransport(url, transportOptions))
		var connectionOptions = RemoteConnectionOptions(
			role: .mobile,
			deviceId: options.link.deviceId,
			deviceName: options.link.deviceName,
			capabilities: RemoteCapabilities(chat: true, sessionRead: true),
			identity: options.link.identity
		)
		connectionOptions.expectedPeerIdentityKey = expectedPeerIdentityKey
		connectionOptions.now = options.now
		let connection = RemoteConnection(transport: transport, options: connectionOptions)
		connections.append(connection)
		return await withCheckedContinuation { continuation in
			var settled = false
			var off: (() -> Void)?
			var timer: Task<Void, Never>?
			let finish = { (result: Outcome) in
				if settled { return }
				settled = true
				timer?.cancel()
				off?()
				if case .failed = result { connection.close() }
				continuation.resume(returning: result)
			}
			timer = schedule(after: timeoutMs) { finish(.failed(.unreachable)) }
			off = connection.onEvent { [weak self] event in
				switch event {
				case .state(.online):
					finish(.online(connection))
				case .state(.pendingApproval):
					let snapshot = connection.snapshot
					self?.options.onPhase(.awaitingApproval(verificationCode: snapshot.verificationCode ?? "", desktopName: snapshot.peerDeviceId))
					timer?.cancel()
					timer = schedule(after: approvalTimeoutMs) { finish(.failed(.unreachable)) }
				case let .error(error) where error.code == .unauthorized:
					finish(.failed(.unauthorized))
				case .state(.failed), .state(.reconnecting):
					finish(.failed(classifyFailure(connection.snapshot.lastErrorCode, transport.closeReason)))
				default:
					break
				}
			}
			Task {
				do { try await connection.connect() } catch { finish(.failed(.unreachable)) }
			}
		}
	}

	private func waitForPaired(_ connection: RemoteConnection, timeoutMs: Double) async -> RemoteDevicePaired? {
		await withCheckedContinuation { continuation in
			var settled = false
			var off: (() -> Void)?
			var timer: Task<Void, Never>?
			let finish = { (value: RemoteDevicePaired?) in
				if settled { return }
				settled = true
				timer?.cancel()
				off?()
				continuation.resume(returning: value)
			}
			timer = schedule(after: timeoutMs) { finish(nil) }
			off = connection.onEvent { event in
				guard case let .remoteEvent(remote) = event, remote.name == .devicePaired,
				      let paired = RemoteAPI.readDevicePaired(remote.payload) else { return }
				finish(paired)
			}
		}
	}

	private func fail(_ reason: PairingFailure) {
		if cancelled { return }
		options.onPhase(.failed(reason))
	}
}

/// The acceptor explains a rejection only through the close reason, which the
/// connection does not surface; observe it at the transport seam.
private final class CloseReasonTransport: RemoteTransport {
	let inner: RemoteTransport
	var closeReason: String?

	init(inner: RemoteTransport) { self.inner = inner }

	func connect(_ handlers: RemoteTransportHandlers) async throws {
		try await inner.connect(RemoteTransportHandlers(
			onFrame: handlers.onFrame,
			onClose: { [weak self] reason in
				self?.closeReason = reason
				handlers.onClose(reason)
			}
		))
	}

	func send(_ frame: RemoteFrame) throws { try inner.send(frame) }
	func close(reason: String?) { inner.close(reason: reason) }
}

func classifyFailure(_ code: RemoteErrorCode?, _ closeReason: String?) -> PairingFailure {
	if code == .unauthorized { return .unauthorized }
	if code == .approvalRejected { return .rejected }
	let reason = closeReason?.lowercased() ?? ""
	if reason.contains("not approved") || reason.contains("rejected") { return .rejected }
	if reason.contains("pinned key") || reason.contains("not paired") || reason.contains("unauthorized") { return .unauthorized }
	return .unreachable
}
