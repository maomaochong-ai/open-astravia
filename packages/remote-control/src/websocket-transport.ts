import { encodeRemoteFrame, parseRemoteFrame } from "./protocol.js";
import type { RemoteFrame, RemoteTransport, RemoteTransportHandlers } from "./types.js";

export interface RemoteWebSocket {
	readonly readyState: number;
	onopen: (() => void) | null;
	onerror: (() => void) | null;
	onclose: ((event: { reason?: string }) => void) | null;
	onmessage: ((event: { data: unknown }) => void) | null;
	send(data: string): void;
	close(code?: number, reason?: string): void;
}

export type RemoteWebSocketFactory = (url: string, protocols?: readonly string[]) => RemoteWebSocket;

export const REMOTE_WEBSOCKET_PROTOCOL = "vetta.remote.v2";
/** Carries the pairing secret; kept out of the URL so proxies and logs never see it. */
export const PAIRING_PROTOCOL_PREFIX = "vetta.pairing.";
/** Declares a manual pairing that must be approved at the desktop instead of presenting a secret. */
export const MANUAL_PAIRING_PROTOCOL = "vetta.manual";
/** Close code used by an endpoint that rejected the peer at the protocol level. */
export const REMOTE_CLOSE_CODE_REJECTED = 4003;
const WEBSOCKET_OPEN = 1;

export interface WebSocketRemoteTransportOptions {
	readonly pairingSecret?: string;
	readonly manual?: boolean;
	readonly createSocket?: RemoteWebSocketFactory;
}

/** WebSocket adapter with no dependency on DOM, Electron, or a specific runtime. */
export class WebSocketRemoteTransport implements RemoteTransport {
	private socket: RemoteWebSocket | undefined;
	private handlers: RemoteTransportHandlers | undefined;
	private readonly createSocket: RemoteWebSocketFactory;

	constructor(
		private readonly url: string,
		private readonly options: WebSocketRemoteTransportOptions = {},
	) {
		this.createSocket = options.createSocket ?? defaultWebSocketFactory;
	}

	/** Wraps a socket an acceptor already holds open (the desktop LAN server). */
	static fromOpenSocket(socket: RemoteWebSocket): WebSocketRemoteTransport {
		const transport = new WebSocketRemoteTransport("", { createSocket: () => socket });
		transport.socket = socket;
		return transport;
	}

	async connect(handlers: RemoteTransportHandlers): Promise<void> {
		this.handlers = handlers;
		const socket = this.socket ?? this.createSocket(this.url, buildProtocols(this.options));
		this.socket = socket;
		socket.onmessage = (event) => this.handleMessage(event.data);
		socket.onclose = (event) => this.handlers?.onClose(event.reason);
		if (socket.readyState === WEBSOCKET_OPEN) return;
		await new Promise<void>((resolve, reject) => {
			socket.onopen = () => resolve();
			socket.onerror = () => reject(new Error("remote websocket connection failed"));
		});
	}

	async send(frame: RemoteFrame): Promise<void> {
		if (!this.socket) throw new Error("remote websocket is not connected");
		this.socket.send(encodeRemoteFrame(frame));
	}

	async close(reason?: string): Promise<void> {
		const socket = this.socket;
		this.socket = undefined;
		if (!socket) return;
		if (reason) socket.close(REMOTE_CLOSE_CODE_REJECTED, reason.slice(0, 120));
		else socket.close();
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

export function buildProtocols(options: Pick<WebSocketRemoteTransportOptions, "pairingSecret" | "manual">): string[] {
	const protocols = [REMOTE_WEBSOCKET_PROTOCOL];
	if (options.pairingSecret) protocols.push(`${PAIRING_PROTOCOL_PREFIX}${options.pairingSecret}`);
	else if (options.manual) protocols.push(MANUAL_PAIRING_PROTOCOL);
	return protocols;
}

export interface OfferedProtocols {
	readonly remote: boolean;
	readonly pairingSecret?: string;
	readonly manual: boolean;
}

/** Parses the `Sec-WebSocket-Protocol` offer on the accepting side. */
export function parseOfferedProtocols(header: string | readonly string[] | null | undefined): OfferedProtocols {
	const raw: readonly string[] = typeof header === "string" ? header.split(",") : (header ?? []);
	const entries = raw.map((entry) => entry.trim()).filter(Boolean);
	let pairingSecret: string | undefined;
	let manual = false;
	let remote = false;
	for (const entry of entries) {
		if (entry === REMOTE_WEBSOCKET_PROTOCOL) remote = true;
		else if (entry === MANUAL_PAIRING_PROTOCOL) manual = true;
		else if (entry.startsWith(PAIRING_PROTOCOL_PREFIX))
			pairingSecret = entry.slice(PAIRING_PROTOCOL_PREFIX.length) || undefined;
	}
	return { remote, pairingSecret, manual };
}

function defaultWebSocketFactory(url: string, protocols?: readonly string[]): RemoteWebSocket {
	if (typeof globalThis.WebSocket !== "function") {
		throw new Error("WebSocket is not available in this runtime");
	}
	return new globalThis.WebSocket(url, protocols ? [...protocols] : undefined) as unknown as RemoteWebSocket;
}
