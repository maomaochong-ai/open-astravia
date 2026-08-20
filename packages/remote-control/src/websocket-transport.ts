import { encodeRemoteFrame, parseRemoteFrame } from "./protocol.js";
import type { RemoteFrame, RemoteTransport, RemoteTransportHandlers } from "./types.js";

export interface RemoteWebSocket {
	readonly readyState: number;
	onopen: (() => void) | null;
	onerror: (() => void) | null;
	onclose: ((event: { reason?: string }) => void) | null;
	onmessage: ((event: { data: unknown }) => void) | null;
	send(data: string): void;
	close(): void;
}

export type RemoteWebSocketFactory = (url: string, protocols?: readonly string[]) => RemoteWebSocket;

export const REMOTE_WEBSOCKET_PROTOCOL = "vetta.remote.v1";
export const PAIRING_PROTOCOL_PREFIX = "vetta.pairing.";
export const BOOTSTRAP_PROTOCOL_PREFIX = "vetta.bootstrap.";
export const RESUME_PROTOCOL_PREFIX = "vetta.resume.";

/** WebSocket adapter with no dependency on DOM, Electron, or a specific runtime. */
export class WebSocketRemoteTransport implements RemoteTransport {
	private socket: RemoteWebSocket | undefined;
	private handlers: RemoteTransportHandlers | undefined;

	constructor(
		private readonly url: string,
		private readonly createSocket: RemoteWebSocketFactory = defaultWebSocketFactory,
	) {}

	async connect(handlers: RemoteTransportHandlers): Promise<void> {
		this.handlers = handlers;
		const { url, pairingToken, bootstrapToken, resumeToken } = splitPairingTarget(this.url);
		const protocols = pairingToken
			? [
					REMOTE_WEBSOCKET_PROTOCOL,
					`${PAIRING_PROTOCOL_PREFIX}${pairingToken}`,
					...(bootstrapToken ? [`${BOOTSTRAP_PROTOCOL_PREFIX}${bootstrapToken}`] : []),
					...(resumeToken ? [`${RESUME_PROTOCOL_PREFIX}${resumeToken}`] : []),
				]
			: undefined;
		const socket = this.createSocket(url, protocols);
		this.socket = socket;
		socket.onmessage = (event) => this.handleMessage(event.data);
		socket.onclose = (event) => this.handlers?.onClose(event.reason);
		await new Promise<void>((resolve, reject) => {
			socket.onopen = () => resolve();
			socket.onerror = () => reject(new Error("remote websocket connection failed"));
		});
	}

	async send(frame: RemoteFrame): Promise<void> {
		if (!this.socket) throw new Error("remote websocket is not connected");
		this.socket.send(encodeRemoteFrame(frame));
	}

	async close(): Promise<void> {
		this.socket?.close();
		this.socket = undefined;
	}

	private handleMessage(data: unknown): void {
		if (typeof data !== "string") {
			this.handlers?.onClose("remote websocket returned a non-text frame");
			return;
		}
		for (const line of data.split("\n").filter(Boolean)) {
			try {
				this.handlers?.onFrame(parseRemoteFrame(line));
			} catch {
				this.handlers?.onClose("remote websocket returned an invalid frame");
				return;
			}
		}
	}
}

export function splitPairingTarget(target: string): {
	readonly url: string;
	readonly pairingToken?: string;
	readonly bootstrapToken?: string;
	readonly resumeToken?: string;
} {
	const separator = target.indexOf("#");
	if (separator < 0) return { url: target };
	const fragment = target.slice(separator + 1);
	const url = target.slice(0, separator);
	if (!fragment) return { url };
	if (!fragment.includes("=")) return { url, pairingToken: fragment };
	const values = new URLSearchParams(fragment);
	const pairingToken = values.get("pairing") ?? undefined;
	const bootstrapToken = values.get("bootstrap") ?? undefined;
	const resumeToken = values.get("resume") ?? undefined;
	return { url, pairingToken, bootstrapToken, resumeToken };
}

function defaultWebSocketFactory(url: string, protocols?: readonly string[]): RemoteWebSocket {
	if (typeof globalThis.WebSocket !== "function") {
		throw new Error("WebSocket is not available in this runtime");
	}
	return new globalThis.WebSocket(url, protocols ? [...protocols] : undefined) as unknown as RemoteWebSocket;
}
