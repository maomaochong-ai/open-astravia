import { createServer, type IncomingMessage, type Server } from "node:http";
import type { Duplex } from "node:stream";
import {
	bytesEqual,
	decodePublicKey,
	KEEPALIVE_PING,
	KEEPALIVE_PONG,
	parseOfferedProtocols,
	REMOTE_PROTOCOL_VERSION,
	REMOTE_WEBSOCKET_PROTOCOL,
	RemoteConnection,
	type RemoteEventJournalPort,
	type RemoteHello,
	type RemoteHelloDecision,
	type RemoteIdentityKeyPair,
	sha256Hex,
	WebSocketRemoteTransport,
} from "@vetta/remote-control";
import { type WebSocket as NodeWebSocket, WebSocketServer } from "ws";
import { getAppLogger } from "../logger.js";
import { adaptNodeWebSocket } from "./desktop-websocket.js";

export const REMOTE_LAN_DEFAULT_PORT = 43117;
const PORT_ATTEMPTS = 20;
const LAN_PATH = /^\/v2\/lan\/([A-Za-z0-9_-]{16,128})$/;
export const LAN_MANUAL_PATH = "/v2/lan/pair";

export interface LanDeviceCredential {
	readonly id: string;
	readonly mobileSecretHash: string;
	readonly mobileIdentityKey?: string;
}

export interface LanAcceptedLink {
	readonly connection: RemoteConnection;
	/** Identity key the peer presented; the manager pins it on first success. */
	readonly peerIdentityKey: () => string | undefined;
}

export interface DesktopRemoteLanServerOptions {
	readonly identity: RemoteIdentityKeyPair;
	readonly deviceId: string;
	readonly deviceName: string;
	readonly lookupDevice: (pairingId: string) => LanDeviceCredential | undefined;
	/**
	 * Decides a secret-based hello: approve pins the key when the device is
	 * unclaimed, reject when a different phone presents a claimed secret.
	 */
	readonly onDeviceHello: (device: LanDeviceCredential, hello: RemoteHello) => RemoteHelloDecision;
	/** A manual pairing arrived; the manager shows the code and resolves with the person's decision. */
	readonly onManualHello: (hello: RemoteHello, verificationCode: string, connectionId: string) => Promise<boolean>;
	readonly onAccepted: (
		kind: { readonly type: "device"; readonly id: string } | { readonly type: "manual" },
		link: LanAcceptedLink,
	) => void;
	readonly journalFor: (deviceId: string) => RemoteEventJournalPort;
}

const log = getAppLogger("remote-lan");

/**
 * Plain HTTP server on the local network that upgrades `/v2/lan/<pairingId>`
 * (secret-based) and `/v2/lan/pair` (manual, approval required) to the
 * encrypted remote protocol. It only ever listens while at least one phone is
 * paired or an invite is outstanding, and accepting a socket costs nothing
 * until the phone finishes the handshake.
 */
export class DesktopRemoteLanServer {
	private server: Server | undefined;
	private wss: WebSocketServer | undefined;
	private port: number | undefined;

	constructor(private readonly options: DesktopRemoteLanServerOptions) {}

	get listeningPort(): number | undefined {
		return this.port;
	}

	async start(preferredPort = REMOTE_LAN_DEFAULT_PORT): Promise<number> {
		if (this.port !== undefined) return this.port;
		const server = createServer((_request, response) => {
			response.statusCode = 426;
			response.setHeader("Content-Type", "text/plain; charset=utf-8");
			response.end("WebSocket upgrade required");
		});
		const wss = new WebSocketServer({
			noServer: true,
			handleProtocols: (protocols) => (protocols.has(REMOTE_WEBSOCKET_PROTOCOL) ? REMOTE_WEBSOCKET_PROTOCOL : false),
			maxPayload: 2 * 1024 * 1024,
		});
		server.on("upgrade", (request, socket, head) => this.handleUpgrade(wss, request, socket, head));
		this.server = server;
		this.wss = wss;
		const port = await listenWithFallback(server, preferredPort);
		this.port = port;
		log.info("remote LAN server listening", { port });
		return port;
	}

	async stop(): Promise<void> {
		const server = this.server;
		const wss = this.wss;
		this.server = undefined;
		this.wss = undefined;
		this.port = undefined;
		if (wss) {
			for (const client of wss.clients) client.close(1001, "server shutting down");
			await new Promise<void>((resolve) => wss.close(() => resolve()));
		}
		if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
		log.info("remote LAN server stopped");
	}

	private handleUpgrade(wss: WebSocketServer, request: IncomingMessage, socket: Duplex, head: Buffer): void {
		const url = new URL(request.url ?? "/", "http://localhost");
		const offered = parseOfferedProtocols(request.headers["sec-websocket-protocol"]);
		if (!offered.remote) {
			rejectUpgrade(socket, 400, "protocol");
			return;
		}
		if (url.pathname === LAN_MANUAL_PATH) {
			if (!offered.manual) {
				rejectUpgrade(socket, 401, "manual pairing required");
				return;
			}
			wss.handleUpgrade(request, socket, head, (client) => this.acceptManual(client));
			return;
		}
		const match = LAN_PATH.exec(url.pathname);
		const device = match?.[1] ? this.options.lookupDevice(match[1]) : undefined;
		if (!device || !offered.pairingSecret) {
			rejectUpgrade(socket, 404, "unknown pairing");
			return;
		}
		if (!constantTimeEquals(sha256Hex(offered.pairingSecret), device.mobileSecretHash)) {
			log.warn("remote LAN pairing secret rejected", { pairingId: device.id });
			rejectUpgrade(socket, 401, "unauthorized");
			return;
		}
		wss.handleUpgrade(request, socket, head, (client) => this.acceptDevice(client, device));
	}

	private acceptDevice(client: NodeWebSocket, device: LanDeviceCredential): void {
		answerKeepalive(client);
		let expected: Uint8Array | undefined;
		if (device.mobileIdentityKey) {
			try {
				expected = decodePublicKey(device.mobileIdentityKey);
			} catch {
				expected = undefined;
			}
		}
		const connection = new RemoteConnection(WebSocketRemoteTransport.fromOpenSocket(adaptNodeWebSocket(client)), {
			role: "desktop",
			handshake: "accept",
			deviceId: this.options.deviceId,
			deviceName: this.options.deviceName,
			capabilities: { chat: true, sessionRead: true },
			identity: this.options.identity,
			expectedPeerIdentityKey: expected,
			journal: this.options.journalFor(device.id),
			onHello: (hello) => this.options.onDeviceHello(device, hello),
			logger: connectionLogger(`lan:${device.id.slice(0, 6)}`),
		});
		this.options.onAccepted(
			{ type: "device", id: device.id },
			{ connection, peerIdentityKey: () => connection.getSnapshot().peerIdentityKey },
		);
		void connection.connect().catch((error: unknown) => {
			log.warn("remote LAN accept failed", { error: describe(error) });
		});
	}

	private acceptManual(client: NodeWebSocket): void {
		answerKeepalive(client);
		let connection: RemoteConnection;
		const onHello = (hello: RemoteHello): RemoteHelloDecision => {
			const snapshot = connection.getSnapshot();
			return {
				kind: "pending",
				approval: this.options.onManualHello(hello, snapshot.verificationCode ?? "", snapshot.connectionId),
			};
		};
		connection = new RemoteConnection(WebSocketRemoteTransport.fromOpenSocket(adaptNodeWebSocket(client)), {
			role: "desktop",
			handshake: "accept",
			deviceId: this.options.deviceId,
			deviceName: this.options.deviceName,
			capabilities: { chat: true, sessionRead: true },
			identity: this.options.identity,
			onHello,
			logger: connectionLogger("lan:manual"),
		});
		this.options.onAccepted(
			{ type: "manual" },
			{ connection, peerIdentityKey: () => connection.getSnapshot().peerIdentityKey },
		);
		void connection.connect().catch((error: unknown) => {
			log.warn("remote LAN manual accept failed", { error: describe(error) });
		});
	}
}

function answerKeepalive(client: NodeWebSocket): void {
	client.on("message", (data, isBinary) => {
		if (isBinary) return;
		if (data.toString("utf8") === KEEPALIVE_PING) client.send(KEEPALIVE_PONG);
	});
}

async function listenWithFallback(server: Server, preferredPort: number): Promise<number> {
	let lastError: unknown;
	for (let attempt = 0; attempt < PORT_ATTEMPTS; attempt += 1) {
		const port = preferredPort + attempt;
		try {
			await new Promise<void>((resolve, reject) => {
				const onError = (error: Error): void => {
					server.off("listening", onListening);
					reject(error);
				};
				const onListening = (): void => {
					server.off("error", onError);
					resolve();
				};
				server.once("error", onError);
				server.once("listening", onListening);
				server.listen(port, "0.0.0.0");
			});
			return port;
		} catch (error) {
			lastError = error;
			if (!isAddressInUse(error)) break;
		}
	}
	throw lastError instanceof Error ? lastError : new Error("remote LAN server could not bind a port");
}

function isAddressInUse(error: unknown): boolean {
	return typeof error === "object" && error !== null && (error as { code?: string }).code === "EADDRINUSE";
}

function rejectUpgrade(socket: Duplex, status: number, reason: string): void {
	const text = status === 401 ? "Unauthorized" : status === 404 ? "Not Found" : "Bad Request";
	socket.write(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
	socket.destroy();
	log.debug("remote LAN upgrade rejected", { status, reason });
}

function constantTimeEquals(a: string, b: string): boolean {
	const encoder = new TextEncoder();
	return bytesEqual(encoder.encode(a), encoder.encode(b));
}

function connectionLogger(scope: string) {
	const scoped = getAppLogger(`remote-conn:${scope}`);
	return {
		debug: (message: string, fields?: Record<string, string | number | boolean | undefined>) =>
			scoped.debug(message, fields),
		info: (message: string, fields?: Record<string, string | number | boolean | undefined>) =>
			scoped.info(message, fields),
		warn: (message: string, fields?: Record<string, string | number | boolean | undefined>) =>
			scoped.warn(message, fields),
	};
}

function describe(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export { REMOTE_PROTOCOL_VERSION };
