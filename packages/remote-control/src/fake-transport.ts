import type { RemoteFrame, RemoteTransport, RemoteTransportHandlers } from "./types.js";

export interface FakeTransportOptions {
	readonly latencyMs?: number;
	readonly dropNextSend?: number;
}

export class FakeTransport implements RemoteTransport {
	private peer: FakeTransport | undefined;
	private handlers: RemoteTransportHandlers | undefined;
	private connected = false;
	private readonly latencyMs: number;
	private dropRemaining: number;

	constructor(options: FakeTransportOptions = {}) {
		this.latencyMs = options.latencyMs ?? 0;
		this.dropRemaining = options.dropNextSend ?? 0;
	}

	connectPeer(peer: FakeTransport): void {
		this.peer = peer;
		if (peer.peer !== this) peer.connectPeer(this);
	}

	async connect(handlers: RemoteTransportHandlers): Promise<void> {
		this.handlers = handlers;
		this.connected = true;
	}

	async send(frame: RemoteFrame): Promise<void> {
		if (!this.connected) throw new Error("fake transport is closed");
		if (this.dropRemaining > 0) {
			this.dropRemaining -= 1;
			return;
		}
		const peer = this.peer;
		if (!peer?.connected || !peer.handlers) throw new Error("fake transport peer is offline");
		await delay(this.latencyMs);
		peer.handlers.onFrame(frame);
	}

	async close(): Promise<void> {
		if (!this.connected) return;
		this.connected = false;
		this.handlers?.onClose("fake transport closed");
	}

	forceDisconnect(reason = "fake transport disconnected"): void {
		this.connected = false;
		this.handlers?.onClose(reason);
	}
}

function delay(ms: number): Promise<void> {
	return ms <= 0 ? Promise.resolve() : new Promise((resolve) => setTimeout(resolve, ms));
}
