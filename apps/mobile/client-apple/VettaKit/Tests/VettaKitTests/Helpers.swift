import Foundation
@testable import VettaKit

func sleep(ms: Double) async {
	try? await Task.sleep(nanoseconds: UInt64(ms * 1_000_000))
}

/// Polls until `check` holds or the deadline passes; returns whether it held.
@discardableResult
func eventually(timeoutMs: Double = 3_000, _ check: () -> Bool) async -> Bool {
	let deadline = Date().addingTimeInterval(timeoutMs / 1000)
	while !check() {
		if Date() > deadline { return false }
		await sleep(ms: 5)
	}
	return true
}

func makeLink() -> LinkIdentity {
	LinkIdentity(identity: .generate(), deviceId: "phone-1", deviceName: "Phone")
}

/// A scripted desktop (port of the Expo test helper). LAN URLs get a fresh
/// acceptor bound to a FakeTransport pair; relay URLs join a FakeRelay room.
final class FakeDesktop {
	let identity: RemoteIdentityKeyPair
	let journal: RemoteEventJournal
	let relay = FakeRelay()
	private(set) var acceptors: [RemoteConnection] = []
	private(set) var opened: [String] = []
	var relayDesktop: RemoteConnection?
	/// URL prefixes that never answer.
	var unreachable = Set<String>()
	var lanDelayMs: Double = 1
	var mobileIdentityKey: Data?
	var onHello: ((RemoteHello) async -> RemoteHelloDecision)?
	var onRequest: ((RemoteConnection, RemoteRequest) -> Void)?

	init(identity: RemoteIdentityKeyPair = .generate(), journal: RemoteEventJournal = RemoteEventJournal()) {
		self.identity = identity
		self.journal = journal
	}

	var identityKey: String { Base64URL.encode(identity.publicKey) }

	lazy var createTransport: TransportFactory = { [unowned self] url, options in
		self.opened.append(url)
		if url.contains("/v2/relay/") {
			let parts = url.split(separator: "/")
			let room = parts.count >= 2 ? String(parts[parts.count - 2]) : "room"
			return self.relay.createTransport(pairingId: room, role: .mobile)
		}
		if self.unreachable.contains(where: { url.hasPrefix($0) }) { return DeadTransport() }
		let phoneSide = FakeTransport(latencyMs: self.lanDelayMs)
		let desktopSide = FakeTransport(latencyMs: self.lanDelayMs)
		phoneSide.connectPeer(desktopSide)
		var acceptorOptions = RemoteConnectionOptions(role: .desktop, deviceId: "desktop-1", deviceName: "MacBook Pro", capabilities: RemoteCapabilities(chat: true, sessionRead: true), identity: self.identity)
		acceptorOptions.handshake = .accept
		acceptorOptions.expectedPeerIdentityKey = options.manual ? nil : self.mobileIdentityKey
		acceptorOptions.onHello = self.onHello
		acceptorOptions.journal = self.journal
		let acceptor = RemoteConnection(transport: desktopSide, options: acceptorOptions)
		acceptor.onEvent { [weak self, unowned acceptor] event in
			if case let .remoteRequest(request) = event { self?.onRequest?(acceptor, request) }
		}
		self.acceptors.append(acceptor)
		// The acceptor must be listening before the phone's hello goes out, as a real server is.
		return PreconnectedTransport(inner: phoneSide) { try? await acceptor.connect() }
	}

	/// Brings the desktop's relay side online in the given room.
	@discardableResult
	func connectRelay(_ pairingId: String) async throws -> RemoteConnection {
		var options = RemoteConnectionOptions(role: .desktop, deviceId: "desktop-1", deviceName: "MacBook Pro", capabilities: RemoteCapabilities(chat: true, sessionRead: true), identity: identity)
		options.expectedPeerIdentityKey = mobileIdentityKey
		options.journal = journal
		let connection = RemoteConnection(transport: relay.createTransport(pairingId: pairingId, role: .desktop), options: options)
		connection.onEvent { [weak self, unowned connection] event in
			if case let .remoteRequest(request) = event { self?.onRequest?(connection, request) }
		}
		relayDesktop = connection
		try await connection.connect()
		return connection
	}

	func onlineAcceptor() -> RemoteConnection? {
		acceptors.first { $0.state == .online }
	}
}

/// Runs `before` (bringing the desktop side up) ahead of the phone's own connect.
final class PreconnectedTransport: RemoteTransport {
	let inner: FakeTransport
	let before: () async -> Void

	init(inner: FakeTransport, before: @escaping () async -> Void) {
		self.inner = inner
		self.before = before
	}

	func connect(_ handlers: RemoteTransportHandlers) async throws {
		await before()
		try await inner.connect(handlers)
	}

	func send(_ frame: RemoteFrame) throws { try inner.send(frame) }
	func close(reason: String?) { inner.close(reason: reason) }
}

/// Connects, then silently drops everything: a host that does not answer.
final class DeadTransport: RemoteTransport {
	func connect(_ handlers: RemoteTransportHandlers) async throws {}
	func send(_ frame: RemoteFrame) throws { throw RemoteTransportError("unreachable") }
	func close(reason: String?) {}
}

func desktopRecord(_ desktop: FakeDesktop, lastEventSequence: Int = 0, relay: String? = "wss://relay.example", lan: [String] = ["192.168.1.20:43117"]) -> DesktopRecord {
	DesktopRecord(
		desktopIdentityKey: desktop.identityKey,
		desktopName: "MacBook Pro",
		pairingId: "pair-1234567890abcdef",
		mobileSecret: "secret-1234567890abcdef",
		lanEndpoints: lan,
		relayBaseUrl: relay,
		lastEventSequence: lastEventSequence
	)
}
