import type { RemoteFrame, RemoteHello, RemoteRole, RemoteTransport, RemoteTransportHandlers } from "./types.js";

type ClientRole = Exclude<RemoteRole, "relay">;

interface RelayEndpoint {
	readonly role: ClientRole;
	readonly transport: FakeRelayTransport;
	hello?: RemoteHello;
}

interface RelayRoom {
	mobile?: RelayEndpoint;
	desktop?: RelayEndpoint;
}

/** Deterministic in-memory relay used by connector and recovery integration tests. */
export class FakeRelay {
	private readonly rooms = new Map<string, RelayRoom>();

	createTransport(pairingId: string, role: ClientRole): RemoteTransport {
		if (!pairingId) throw new Error("pairingId is required");
		return new FakeRelayTransport(this, pairingId, role);
	}

	connect(transport: FakeRelayTransport): void {
		const room = this.rooms.get(transport.pairingId) ?? {};
		const existing = room[transport.role];
		if (existing && existing.transport !== transport) existing.transport.notifyClose("replaced by a new connection");
		room[transport.role] = { role: transport.role, transport };
		this.rooms.set(transport.pairingId, room);
	}

	send(transport: FakeRelayTransport, frame: RemoteFrame): void {
		const room = this.rooms.get(transport.pairingId);
		const endpoint = room?.[transport.role];
		if (!room || !endpoint || endpoint.transport !== transport) throw new Error("relay transport is not connected");
		if (frame.type === "hello") {
			endpoint.hello = frame;
			this.acknowledgePair(room);
			return;
		}
		const peer = transport.role === "mobile" ? room.desktop : room.mobile;
		if (!peer?.hello) throw new Error("relay peer is offline");
		peer.transport.deliver(frame);
	}

	disconnect(transport: FakeRelayTransport): void {
		const room = this.rooms.get(transport.pairingId);
		if (!room || room[transport.role]?.transport !== transport) return;
		delete room[transport.role];
		transport.notifyClose("fake relay transport closed");
		const peer = transport.role === "mobile" ? room.desktop : room.mobile;
		peer?.transport.notifyClose("fake relay peer disconnected");
		if (!room.mobile && !room.desktop) this.rooms.delete(transport.pairingId);
	}

	private acknowledgePair(room: RelayRoom): void {
		const mobile = room.mobile;
		const desktop = room.desktop;
		if (!mobile?.hello || !desktop?.hello) return;
		mobile.transport.deliver({
			type: "hello_ack",
			protocolVersion: 1,
			connectionId: mobile.hello.connectionId,
			peerDeviceId: desktop.hello.deviceId,
		});
		desktop.transport.deliver({
			type: "hello_ack",
			protocolVersion: 1,
			connectionId: desktop.hello.connectionId,
			peerDeviceId: mobile.hello.deviceId,
		});
	}
}

class FakeRelayTransport implements RemoteTransport {
	private handlers: RemoteTransportHandlers | undefined;
	private connected = false;

	constructor(
		private readonly relay: FakeRelay,
		readonly pairingId: string,
		readonly role: ClientRole,
	) {}

	async connect(handlers: RemoteTransportHandlers): Promise<void> {
		this.handlers = handlers;
		this.connected = true;
		this.relay.connect(this);
	}

	async send(frame: RemoteFrame): Promise<void> {
		if (!this.connected) throw new Error("fake relay transport is closed");
		this.relay.send(this, frame);
	}

	async close(): Promise<void> {
		if (!this.connected) return;
		this.connected = false;
		this.relay.disconnect(this);
	}

	deliver(frame: RemoteFrame): void {
		if (this.connected) this.handlers?.onFrame(frame);
	}

	notifyClose(reason: string): void {
		if (!this.connected) return;
		this.connected = false;
		this.handlers?.onClose(reason);
	}
}
