import {
	decodePublicKey,
	RemoteConnection,
	type RemoteEventJournalPort,
	type RemoteIdentityKeyPair,
	relayControlUrl,
	WebSocketRemoteTransport,
} from "@vetta/remote-control";
import { getAppLogger } from "../logger.js";
import { createDesktopWebSocketFactory } from "./desktop-websocket.js";

export interface DesktopRemoteRelayLinkOptions {
	readonly relayBaseUrl: string;
	readonly pairingId: string;
	readonly desktopSecret: string;
	readonly mobileSecretHash: string;
	readonly identity: RemoteIdentityKeyPair;
	readonly deviceId: string;
	readonly deviceName: string;
	readonly mobileIdentityKey?: string;
	readonly journal: RemoteEventJournalPort;
	/** Called with every fresh connection before it connects, so the hub can attach. */
	readonly onConnection: (connection: RemoteConnection) => void;
	readonly keepaliveIntervalMs?: number;
	readonly minBackoffMs?: number;
	readonly maxBackoffMs?: number;
}

const log = getAppLogger("remote-relay-link");

/**
 * Keeps one desktop-side connection to a paired phone's relay room. The room
 * is registered on first connect (carrying the phone's credential hash) and
 * the link then parks there: hibernation on the relay side means an idle
 * parked link costs nothing, and reconnects back off exponentially so a long
 * outage never turns into a busy loop.
 */
export class DesktopRemoteRelayLink {
	private connection: RemoteConnection | undefined;
	private unsubscribe: (() => void) | undefined;
	private timer: ReturnType<typeof setTimeout> | undefined;
	private backoffMs: number;
	private stopped = false;

	constructor(private readonly options: DesktopRemoteRelayLinkOptions) {
		this.backoffMs = options.minBackoffMs ?? 1_000;
	}

	start(): void {
		this.stopped = false;
		void this.connect();
	}

	async stop(): Promise<void> {
		this.stopped = true;
		if (this.timer) clearTimeout(this.timer);
		this.timer = undefined;
		this.unsubscribe?.();
		this.unsubscribe = undefined;
		const current = this.connection;
		this.connection = undefined;
		if (current) await current.close().catch(() => undefined);
	}

	get current(): RemoteConnection | undefined {
		return this.connection;
	}

	private async connect(): Promise<void> {
		if (this.stopped) return;
		let expected: Uint8Array | undefined;
		if (this.options.mobileIdentityKey) {
			try {
				expected = decodePublicKey(this.options.mobileIdentityKey);
			} catch {
				expected = undefined;
			}
		}
		const transport = new WebSocketRemoteTransport(
			relayControlUrl(this.options.relayBaseUrl, this.options.pairingId, "desktop"),
			{
				pairingSecret: this.options.desktopSecret,
				peerCredentialHash: this.options.mobileSecretHash,
				createSocket: createDesktopWebSocketFactory(),
				keepaliveIntervalMs: this.options.keepaliveIntervalMs ?? 25_000,
			},
		);
		const connection = new RemoteConnection(transport, {
			role: "desktop",
			handshake: "initiate",
			deviceId: this.options.deviceId,
			deviceName: this.options.deviceName,
			capabilities: { chat: true, sessionRead: true },
			identity: this.options.identity,
			expectedPeerIdentityKey: expected,
			journal: this.options.journal,
			logger: {
				debug: (message, fields) => log.debug(message, fields),
				info: (message, fields) => log.info(message, fields),
				warn: (message, fields) => log.warn(message, fields),
			},
		});
		this.connection = connection;
		this.unsubscribe = connection.onEvent((event) => {
			if (event.type !== "state") return;
			if (event.state === "online") this.backoffMs = this.options.minBackoffMs ?? 1_000;
			if (event.state === "reconnecting" || event.state === "failed") this.scheduleReconnect(connection);
		});
		this.options.onConnection(connection);
		try {
			await connection.connect();
		} catch (error) {
			log.info("remote relay link attempt failed", {
				pairingId: this.options.pairingId.slice(0, 6),
				error: describe(error),
			});
			this.scheduleReconnect(connection);
		}
	}

	private scheduleReconnect(from: RemoteConnection): void {
		if (this.stopped || this.timer || this.connection !== from) return;
		this.unsubscribe?.();
		this.unsubscribe = undefined;
		this.connection = undefined;
		void from.close().catch(() => undefined);
		const delay = this.backoffMs;
		this.backoffMs = Math.min(this.options.maxBackoffMs ?? 30_000, this.backoffMs * 2);
		this.timer = setTimeout(() => {
			this.timer = undefined;
			void this.connect();
		}, delay);
		this.timer.unref?.();
	}
}

function describe(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
