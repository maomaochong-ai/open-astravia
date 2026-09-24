import {
	encodeRemoteFrame,
	MAX_SEALED_CIPHERTEXT_CHARS,
	parseRemoteFrame,
	type RemoteFrame,
	type RemoteTransport,
	type RemoteTransportHandlers,
} from "@vetta/remote-control";

export interface RendererDataChannelPort {
	send(message: string): void;
	close(): void;
}

const MAX_CONTROL_MESSAGE_CHARS = MAX_SEALED_CIPHERTEXT_CHARS + 4_096;

/** Bridges the hidden renderer's opaque WebRTC text channel into RemoteTransport. */
export class RendererDataChannelTransport implements RemoteTransport {
	private handlers: RemoteTransportHandlers | undefined;
	private readonly pending: RemoteFrame[] = [];
	private open = false;
	private closed = false;

	constructor(private readonly port: RendererDataChannelPort) {}

	async connect(handlers: RemoteTransportHandlers): Promise<void> {
		if (this.closed) throw new Error("remote control data channel is closed");
		if (this.handlers) throw new Error("remote control data channel is already connected");
		this.handlers = handlers;
		for (const frame of this.pending.splice(0)) handlers.onFrame(frame);
	}

	async send(frame: RemoteFrame): Promise<void> {
		if (this.closed || !this.open) throw new Error("remote control data channel is not open");
		this.port.send(encodeRemoteFrame(frame));
	}

	async close(reason?: string): Promise<void> {
		if (this.closed) return;
		this.closed = true;
		this.open = false;
		this.pending.length = 0;
		this.port.close();
		this.handlers?.onClose(reason);
	}

	handleOpen(): void {
		if (!this.closed) this.open = true;
	}

	handleMessage(message: unknown): void {
		if (this.closed) return;
		if (typeof message !== "string" || message.length > MAX_CONTROL_MESSAGE_CHARS) {
			void this.close("invalid control data channel payload");
			return;
		}
		try {
			const frame = parseRemoteFrame(message);
			if (this.handlers) this.handlers.onFrame(frame);
			else this.pending.push(frame);
		} catch {
			void this.close("invalid control data channel frame");
		}
	}

	handleClose(reason?: string): void {
		if (this.closed) return;
		this.closed = true;
		this.open = false;
		this.pending.length = 0;
		this.handlers?.onClose(reason);
	}
}
