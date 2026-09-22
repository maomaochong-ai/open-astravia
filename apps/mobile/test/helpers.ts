import {
	FakeRelay,
	FakeTransport,
	generateIdentityKeyPair,
	RemoteConnection,
	RemoteEventJournal,
	type RemoteHelloDecision,
	type RemoteIdentityKeyPair,
	type RemoteTransport,
	toBase64Url,
} from "@vetta/remote-control";
import type { LinkIdentity, TransportOptions } from "../src/remote/types";

export const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
export async function settle(rounds = 8) {
	for (let index = 0; index < rounds; index += 1) await tick();
}

export function makeLink(): LinkIdentity {
	return { identity: generateIdentityKeyPair(), deviceId: "phone-1", deviceName: "Phone" };
}

export interface FakeDesktopOptions {
	readonly identity?: RemoteIdentityKeyPair;
	readonly mobileIdentityKey?: Uint8Array;
	readonly onHello?: (hello: unknown) => RemoteHelloDecision | Promise<RemoteHelloDecision>;
	readonly journal?: RemoteEventJournal;
	readonly onRequest?: (
		connection: RemoteConnection,
		request: { requestId: string; method: string; payload?: unknown; sessionId?: string },
	) => void;
}

/**
 * A scripted desktop. `lan` produces an acceptor bound to a fresh FakeTransport
 * pair per URL; `relay` uses a FakeRelay room. `createTransport` is what the
 * phone-side code receives.
 */
export class FakeDesktop {
	readonly identity: RemoteIdentityKeyPair;
	readonly journal: RemoteEventJournal;
	readonly relay = new FakeRelay();
	readonly acceptors: RemoteConnection[] = [];
	readonly opened: string[] = [];
	relayDesktop: RemoteConnection | undefined;
	/** URLs (by prefix) that should fail instead of accepting. */
	unreachable = new Set<string>();
	/** Real sockets never deliver synchronously; 1 ms keeps handshake ordering realistic. */
	lanDelayMs = 1;

	constructor(private readonly options: FakeDesktopOptions = {}) {
		this.identity = options.identity ?? generateIdentityKeyPair();
		this.journal = options.journal ?? new RemoteEventJournal();
	}

	get identityKey(): string {
		return toBase64Url(this.identity.publicKey);
	}

	createTransport = (url: string, options: TransportOptions): RemoteTransport => {
		this.opened.push(url);
		if (url.includes("/v2/relay/")) {
			const match = /\/v2\/relay\/([^/]+)\/mobile$/.exec(url);
			return this.relay.createTransport(match?.[1] ?? "room", "mobile");
		}
		const phoneSide = new FakeTransport({ latencyMs: this.lanDelayMs });
		for (const prefix of this.unreachable) {
			if (url.startsWith(prefix)) {
				// Never connect the peer: connect() resolves but hello goes nowhere,
				// mimicking a host that does not answer.
				const dead = new FakeTransport();
				return {
					connect: async (handlers) => dead.connect(handlers),
					send: async () => {
						throw new Error("unreachable");
					},
					close: async () => dead.close(),
				};
			}
		}
		const desktopSide = new FakeTransport({ latencyMs: this.lanDelayMs });
		phoneSide.connectPeer(desktopSide);
		const acceptor = new RemoteConnection(desktopSide, {
			role: "desktop",
			deviceId: "desktop-1",
			deviceName: "MacBook Pro",
			capabilities: { chat: true, sessionRead: true },
			handshake: "accept",
			identity: this.identity,
			expectedPeerIdentityKey: options.manual ? undefined : this.options.mobileIdentityKey,
			onHello: this.options.onHello,
			journal: this.journal,
		});
		acceptor.onEvent((event) => {
			if (event.type === "remote-request") this.options.onRequest?.(acceptor, event.request);
		});
		this.acceptors.push(acceptor);
		void acceptor.connect();
		return phoneSide;
	};

	/** Brings the desktop's relay side online in the given room. */
	async connectRelay(pairingId: string): Promise<RemoteConnection> {
		const connection = new RemoteConnection(this.relay.createTransport(pairingId, "desktop"), {
			role: "desktop",
			deviceId: "desktop-1",
			deviceName: "MacBook Pro",
			capabilities: { chat: true, sessionRead: true },
			identity: this.identity,
			expectedPeerIdentityKey: this.options.mobileIdentityKey,
			journal: this.journal,
		});
		connection.onEvent((event) => {
			if (event.type === "remote-request") this.options.onRequest?.(connection, event.request);
		});
		this.relayDesktop = connection;
		await connection.connect();
		return connection;
	}

	onlineAcceptor(): RemoteConnection | undefined {
		return this.acceptors.find((acceptor) => acceptor.getSnapshot().state === "online");
	}
}
