import { encodeRemoteDesktopSignal, parseRemoteDesktopSignal } from "./protocol.js";
import type { RemoteDesktopSignal } from "./types.js";
import { REMOTE_DESKTOP_WEBSOCKET_PROTOCOL } from "./types.js";

export interface RemoteDesktopWebSocket {
	readonly readyState: number;
	onopen: (() => void) | null;
	onerror: (() => void) | null;
	onclose: ((event: { readonly reason?: string }) => void) | null;
	onmessage: ((event: { readonly data: unknown }) => void) | null;
	send(data: string): void;
	close(): void;
}

export type RemoteDesktopWebSocketFactory = (url: string, protocols?: readonly string[]) => RemoteDesktopWebSocket;

export interface RemoteDesktopSignalingHandlers {
	onSignal(signal: RemoteDesktopSignal): void;
	onClose(reason?: string): void;
}

/**
 * WebSocket signaling adapter. The pairing token is stripped from the URL and offered as a subprotocol.
 *
 * `connect` may be called again after `onClose` to reopen signaling: a peer connection that
 * is already up does not depend on it. A connection that never opens rejects `connect`
 * without calling `onClose`.
 */
export class WebSocketRemoteDesktopSignaling {
	private socket: RemoteDesktopWebSocket | undefined;
	private handlers: RemoteDesktopSignalingHandlers | undefined;

	constructor(
		private readonly target: string,
		private readonly createSocket: RemoteDesktopWebSocketFactory = defaultSocket,
	) {}

	get connected(): boolean {
		return this.socket !== undefined;
	}

	async connect(handlers: RemoteDesktopSignalingHandlers): Promise<void> {
		this.handlers = handlers;
		const { url, token } = splitTarget(this.target);
		const socket = this.createSocket(
			url,
			token ? [REMOTE_DESKTOP_WEBSOCKET_PROTOCOL, `vetta.pairing.${token}`] : undefined,
		);
		this.socket = socket;
		socket.onmessage = (event) => {
			if (this.socket !== socket) return;
			if (typeof event.data !== "string") return this.closeWith("desktop signaling returned a binary frame");
			try {
				this.handlers?.onSignal(parseRemoteDesktopSignal(event.data));
			} catch {
				this.closeWith("desktop signaling returned an invalid frame");
			}
		};
		await new Promise<void>((resolve, reject) => {
			let opened = false;
			socket.onopen = () => {
				opened = true;
				resolve();
			};
			socket.onerror = () => {
				if (opened) return;
				if (this.socket === socket) this.socket = undefined;
				reject(new Error("desktop signaling connection failed"));
			};
			socket.onclose = (event) => {
				if (this.socket !== socket) return;
				this.socket = undefined;
				if (opened) this.handlers?.onClose(event.reason);
				else reject(new Error("desktop signaling connection failed"));
			};
		});
	}

	async send(signal: RemoteDesktopSignal): Promise<void> {
		if (!this.socket) throw new Error("desktop signaling is not connected");
		this.socket.send(`${encodeRemoteDesktopSignal(signal)}\n`);
	}

	async close(): Promise<void> {
		const socket = this.socket;
		this.socket = undefined;
		socket?.close();
	}

	private closeWith(reason: string): void {
		const socket = this.socket;
		this.socket = undefined;
		this.handlers?.onClose(reason);
		socket?.close();
	}
}

function splitTarget(target: string): { readonly url: string; readonly token?: string } {
	const separator = target.indexOf("#");
	if (separator < 0) return { url: target };
	const fragment = target.slice(separator + 1);
	const url = target.slice(0, separator);
	if (!fragment) return { url };
	if (!fragment.includes("=")) return { url, token: fragment };
	const token = new URLSearchParams(fragment).get("pairing") ?? undefined;
	return token ? { url, token } : { url };
}

function defaultSocket(url: string, protocols?: readonly string[]): RemoteDesktopWebSocket {
	if (typeof globalThis.WebSocket !== "function") throw new Error("WebSocket is not available in this runtime");
	return new globalThis.WebSocket(url, protocols ? [...protocols] : undefined) as unknown as RemoteDesktopWebSocket;
}
