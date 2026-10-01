import Foundation

/// Deterministic in-memory transport pair (port of `fake-transport.ts`) used by
/// tests and SwiftUI previews. Delivery is asynchronous and in order.
public final class FakeTransport: RemoteTransport {
	private weak var peer: FakeTransport?
	private var strongPeer: FakeTransport?
	private var handlers: RemoteTransportHandlers?
	private var connected = false
	private let latencyMs: Double
	private var dropRemaining: Int
	private var outbox: [RemoteFrame] = []
	private var draining = false

	public init(latencyMs: Double = 0, dropNextSend: Int = 0) {
		self.latencyMs = latencyMs
		dropRemaining = dropNextSend
	}

	public func connectPeer(_ other: FakeTransport) {
		peer = other
		strongPeer = other
		if other.peer !== self { other.connectPeer(self) }
	}

	public func connect(_ handlers: RemoteTransportHandlers) async throws {
		self.handlers = handlers
		connected = true
	}

	public func send(_ frame: RemoteFrame) throws {
		guard connected else { throw RemoteTransportError("fake transport is closed") }
		if dropRemaining > 0 {
			dropRemaining -= 1
			return
		}
		guard let peer, peer.connected, peer.handlers != nil else {
			throw RemoteTransportError("fake transport peer is offline")
		}
		outbox.append(frame)
		guard !draining else { return }
		draining = true
		schedule(after: latencyMs) { [weak self] in self?.drain() }
	}

	private func drain() {
		draining = false
		let frames = outbox
		outbox.removeAll()
		for frame in frames {
			guard let peer, peer.connected else { return }
			peer.handlers?.onFrame(frame)
		}
	}

	public func close(reason: String?) {
		guard connected else { return }
		connected = false
		let reason = reason ?? "fake transport closed"
		handlers?.onClose(reason)
		peer?.forceDisconnect(reason)
		strongPeer = nil
	}

	public func forceDisconnect(_ reason: String = "fake transport disconnected") {
		connected = false
		handlers?.onClose(reason)
		strongPeer = nil
	}
}

/// In-memory relay mirroring the Cloudflare contract (port of `fake-relay.ts`):
/// consumes `hello`, answers both sides with `hello_ack`, forwards sealed frames
/// unchanged and announces peer presence.
public final class FakeRelay {
	final class Endpoint {
		let transport: FakeRelayTransport
		var hello: RemoteHello?
		init(transport: FakeRelayTransport) { self.transport = transport }
	}

	final class Room {
		var mobile: Endpoint?
		var desktop: Endpoint?
		subscript(role: RemoteRole) -> Endpoint? {
			get { role == .mobile ? mobile : desktop }
			set { if role == .mobile { mobile = newValue } else { desktop = newValue } }
		}
	}

	private var rooms: [String: Room] = [:]

	public init() {}

	public func createTransport(pairingId: String, role: RemoteRole) -> RemoteTransport {
		FakeRelayTransport(relay: self, pairingId: pairingId, role: role)
	}

	func connect(_ transport: FakeRelayTransport) {
		let room = rooms[transport.pairingId] ?? Room()
		if let existing = room[transport.role], existing.transport !== transport {
			existing.transport.notifyClose("replaced by a new connection")
		}
		room[transport.role] = Endpoint(transport: transport)
		rooms[transport.pairingId] = room
	}

	func send(_ transport: FakeRelayTransport, _ frame: RemoteFrame) throws {
		guard let room = rooms[transport.pairingId], let endpoint = room[transport.role], endpoint.transport === transport else {
			throw RemoteTransportError("relay transport is not connected")
		}
		if case let .hello(hello) = frame {
			endpoint.hello = hello
			acknowledgePair(room)
			return
		}
		guard case .sealed = frame else { throw RemoteTransportError("relay refuses plaintext \(frame.typeName) frame") }
		let peer = transport.role == .mobile ? room.desktop : room.mobile
		guard let peer, peer.hello != nil else {
			endpoint.transport.deliver(.peerStatus(online: false))
			return
		}
		peer.transport.deliver(frame)
	}

	func disconnect(_ transport: FakeRelayTransport) {
		guard let room = rooms[transport.pairingId], room[transport.role]?.transport === transport else { return }
		room[transport.role] = nil
		transport.notifyClose("fake relay transport closed")
		let peer = transport.role == .mobile ? room.desktop : room.mobile
		peer?.transport.deliver(.peerStatus(online: false))
		if room.mobile == nil, room.desktop == nil { rooms[transport.pairingId] = nil }
	}

	private func acknowledgePair(_ room: Room) {
		guard let mobile = room.mobile, let desktop = room.desktop, let mobileHello = mobile.hello, let desktopHello = desktop.hello else { return }
		mobile.transport.deliver(.helloAck(RemoteHelloAck(
			connectionId: mobileHello.connectionId,
			peerDeviceId: desktopHello.deviceId,
			peerIdentityKey: desktopHello.identityKey,
			peerEphemeralKey: desktopHello.ephemeralKey
		)))
		desktop.transport.deliver(.helloAck(RemoteHelloAck(
			connectionId: desktopHello.connectionId,
			peerDeviceId: mobileHello.deviceId,
			peerIdentityKey: mobileHello.identityKey,
			peerEphemeralKey: mobileHello.ephemeralKey
		)))
	}
}

final class FakeRelayTransport: RemoteTransport {
	private let relay: FakeRelay
	let pairingId: String
	let role: RemoteRole
	private var handlers: RemoteTransportHandlers?
	private var connected = false
	private var inbox: [RemoteFrame] = []
	private var draining = false

	init(relay: FakeRelay, pairingId: String, role: RemoteRole) {
		self.relay = relay
		self.pairingId = pairingId
		self.role = role
	}

	func connect(_ handlers: RemoteTransportHandlers) async throws {
		self.handlers = handlers
		connected = true
		relay.connect(self)
	}

	func send(_ frame: RemoteFrame) throws {
		guard connected else { throw RemoteTransportError("fake relay transport is closed") }
		try relay.send(self, frame)
	}

	func close(reason: String?) {
		guard connected else { return }
		connected = false
		relay.disconnect(self)
	}

	/// Frames are delivered asynchronously in per-socket order, like a real socket.
	func deliver(_ frame: RemoteFrame) {
		guard connected else { return }
		inbox.append(frame)
		guard !draining else { return }
		draining = true
		schedule(after: 0) { [weak self] in
			guard let self else { return }
			self.draining = false
			while !self.inbox.isEmpty, self.connected {
				self.handlers?.onFrame(self.inbox.removeFirst())
			}
		}
	}

	func notifyClose(_ reason: String) {
		guard connected else { return }
		connected = false
		handlers?.onClose(reason)
	}
}
