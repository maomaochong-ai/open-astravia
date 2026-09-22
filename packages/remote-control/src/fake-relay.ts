import type { RemoteFrame, RemoteHello, RemoteRole, RemoteTransport, RemoteTransportHandlers } from "./types.js";
import { REMOTE_PROTOCOL_VERSION } from "./types.js";

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

/**
 * Deterministic in-memory relay used by connector and recovery integration
 * tests. Mirrors the Cloudflare relay contract: it consumes `hello`, answers
 * both sides with `hello_ack` carrying the peer's keys, forwards sealed frames
 * unchanged and announces peer presence.
 */
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
		if (frame.type !== "sealed") throw new Error(`relay refuses plaintext ${frame.type} frame`);
		const peer = transport.role === "mobile" ? room.desktop : room.mobile;
		if (!peer?.hello) {
			endpoint.transport.deliver({ type: "peer_status", online: false });
			return;
		}
		peer.transport.deliver(frame);
	}

	disconnect(transport: FakeRelayTransport): void {
		const room = this.rooms.get(transport.pairingId);
		if (!room || room[transport.role]?.transport !== transport) return;
		delete room[transport.role];
		transport.notifyClose("fake relay transport closed");
		const peer = transport.role === "mobile" ? room.desktop : room.mobile;
		peer?.transport.deliver({ type: "peer_status", online: false });
		if (!room.mobile && !room.desktop) this.rooms.delete(transport.pairingId);
	}

	private acknowledgePair(room: RelayRoom): void {
		const mobile = room.mobile;
		const desktop = room.desktop;
		if (!mobile?.hello || !desktop?.hello) return;
		mobile.transport.deliver({
			type: "hello_ack",
			protocolVersion: REMOTE_PROTOCOL_VERSION,
			connectionId: mobile.hello.connectionId,
			peerDeviceId: desktop.hello.deviceId,
			peerIdentityKey: desktop.hello.identityKey,
			peerEphemeralKey: desktop.hello.ephemeralKey,
		});
		desktop.transport.deliver({
			type: "hello_ack",
			protocolVersion: REMOTE_PROTOCOL_VERSION,
			connectionId: desktop.hello.connectionId,
			peerDeviceId: mobile.hello.deviceId,
			peerIdentityKey: mobile.hello.identityKey,
			peerEphemeralKey: mobile.hello.ephemeralKey,
		});
	}
}

class FakeRelayTransport implements RemoteTransport {
	private handlers: RemoteTransportHandlers | undefined;
	private connected = false;
	private readonly inbox: RemoteFrame[] = [];
	private draining = false;

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

	/**
	 * Frames are delivered asynchronously in per-socket order, like a real
	 * socket: a `hello_ack` queued for this endpoint is always seen before a
	 * frame the peer sends in reaction to its own acknowledgement.
	 */
	deliver(frame: RemoteFrame): void {
		if (!this.connected) return;
		this.inbox.push(frame);
		if (this.draining) return;
		this.draining = true;
		queueMicrotask(() => {
			this.draining = false;
			while (this.inbox.length > 0 && this.connected) this.handlers?.onFrame(this.inbox.shift()!);
		});
	}

	notifyClose(reason: string): void {
		if (!this.connected) return;
		this.connected = false;
		this.handlers?.onClose(reason);
	}
}
