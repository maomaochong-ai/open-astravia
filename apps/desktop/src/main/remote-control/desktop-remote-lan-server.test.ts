import {
	decodePublicKey,
	generateIdentityKeyPair,
	lanControlUrl,
	RemoteConnection,
	RemoteEventJournal,
	type RemoteHello,
	randomToken,
	sha256Hex,
	toBase64Url,
	WebSocketRemoteTransport,
} from "@vetta/remote-control";
import { afterEach, describe, expect, it } from "vitest";
import { DesktopRemoteLanServer, LAN_MANUAL_PATH } from "./desktop-remote-lan-server.js";
import { createDesktopWebSocketFactory } from "./desktop-websocket.js";

const capabilities = { chat: true, sessionRead: true } as const;

async function waitFor(check: () => boolean, timeoutMs = 3_000): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (!check()) {
		if (Date.now() > deadline) throw new Error("condition not met in time");
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
}

describe("DesktopRemoteLanServer", () => {
	const servers: DesktopRemoteLanServer[] = [];
	const connections: RemoteConnection[] = [];
	afterEach(async () => {
		for (const connection of connections.splice(0)) await connection.close().catch(() => undefined);
		for (const server of servers.splice(0)) await server.stop();
	});

	function phone(url: string, options: { pairingSecret?: string; manual?: boolean; expected?: Uint8Array }) {
		const identity = generateIdentityKeyPair();
		const connection = new RemoteConnection(
			new WebSocketRemoteTransport(url, {
				pairingSecret: options.pairingSecret,
				manual: options.manual,
				createSocket: createDesktopWebSocketFactory(),
				keepaliveIntervalMs: 20,
			}),
			{
				role: "mobile",
				deviceId: "phone-1",
				deviceName: "iPhone",
				capabilities,
				identity,
				expectedPeerIdentityKey: options.expected,
			},
		);
		connections.push(connection);
		return { connection, identity };
	}

	it("pairs a phone that presents the invite secret, pins it and answers requests over the sealed link", async () => {
		const desktopIdentity = generateIdentityKeyPair();
		const mobileSecret = randomToken(32);
		const pairingId = randomToken(24);
		let pinned: string | undefined;
		const journal = new RemoteEventJournal();
		let accepted: RemoteConnection | undefined;
		const server = new DesktopRemoteLanServer({
			identity: desktopIdentity,
			deviceId: "desktop-1",
			deviceName: "MacBook",
			lookupDevice: (id) =>
				id === pairingId ? { id, mobileSecretHash: sha256Hex(mobileSecret), mobileIdentityKey: pinned } : undefined,
			onDeviceHello: (_device, hello: RemoteHello) => {
				pinned = hello.identityKey;
				return { kind: "approve" };
			},
			onManualHello: async () => false,
			onAccepted: (kind, link) => {
				if (kind.type === "device") {
					accepted = link.connection;
					link.connection.onEvent((event) => {
						if (event.type === "remote-request") {
							void link.connection.respond(event.request.requestId, {
								success: true,
								payload: { ok: event.request.method },
							});
						}
					});
				}
			},
			journalFor: () => journal,
		});
		servers.push(server);
		const port = await server.start(49_300 + Math.floor(Math.random() * 100));

		const { connection, identity } = phone(lanControlUrl(`127.0.0.1:${port}`, pairingId), {
			pairingSecret: mobileSecret,
			expected: desktopIdentity.publicKey,
		});
		await connection.connect();
		await waitFor(() => connection.getSnapshot().state === "online");
		expect(pinned).toBe(toBase64Url(identity.publicKey));
		expect(connection.getSnapshot().peerDeviceId).toBe("desktop-1");
		await expect(connection.request("session.list")).resolves.toEqual({ ok: "session.list" });
		expect(accepted?.getSnapshot().state).toBe("online");

		// A second phone with the same secret but another identity is refused now that the key is pinned.
		const impostor = phone(lanControlUrl(`127.0.0.1:${port}`, pairingId), {
			pairingSecret: mobileSecret,
			expected: desktopIdentity.publicKey,
		});
		await impostor.connection.connect();
		await waitFor(() => impostor.connection.getSnapshot().state === "reconnecting");
		expect(impostor.connection.getSnapshot().peerDeviceId).toBeUndefined();
	});

	it("rejects wrong secrets before any handshake and never wakes the connection", async () => {
		const pairingId = randomToken(24);
		let helloSeen = false;
		const server = new DesktopRemoteLanServer({
			identity: generateIdentityKeyPair(),
			deviceId: "desktop-1",
			deviceName: "MacBook",
			lookupDevice: (id) => (id === pairingId ? { id, mobileSecretHash: sha256Hex("right") } : undefined),
			onDeviceHello: () => {
				helloSeen = true;
				return { kind: "approve" };
			},
			onManualHello: async () => false,
			onAccepted: () => undefined,
			journalFor: () => new RemoteEventJournal(),
		});
		servers.push(server);
		const port = await server.start(49_500 + Math.floor(Math.random() * 100));
		const { connection } = phone(lanControlUrl(`127.0.0.1:${port}`, pairingId), { pairingSecret: "wrong" });
		await expect(connection.connect()).rejects.toThrow();
		const unknown = phone(lanControlUrl(`127.0.0.1:${port}`, randomToken(24)), { pairingSecret: "right" });
		await expect(unknown.connection.connect()).rejects.toThrow();
		expect(helloSeen).toBe(false);
	});

	it("holds a manual pairing until the desktop approves the verification code", async () => {
		const desktopIdentity = generateIdentityKeyPair();
		let codeAtDesktop: string | undefined;
		let approve: ((value: boolean) => void) | undefined;
		const server = new DesktopRemoteLanServer({
			identity: desktopIdentity,
			deviceId: "desktop-1",
			deviceName: "MacBook",
			lookupDevice: () => undefined,
			onDeviceHello: () => ({ kind: "reject", reason: "unexpected" }),
			onManualHello: (_hello, code) =>
				new Promise<boolean>((resolve) => {
					codeAtDesktop = code;
					approve = resolve;
				}),
			onAccepted: () => undefined,
			journalFor: () => new RemoteEventJournal(),
		});
		servers.push(server);
		const port = await server.start(49_700 + Math.floor(Math.random() * 100));
		const { connection } = phone(`ws://127.0.0.1:${port}${LAN_MANUAL_PATH}`, { manual: true });
		await connection.connect();
		await waitFor(() => connection.getSnapshot().state === "pending_approval");
		expect(codeAtDesktop).toMatch(/^\d{6}$/);
		expect(connection.getSnapshot().verificationCode).toBe(codeAtDesktop);
		expect(connection.getSnapshot().peerIdentityKey).toBe(toBase64Url(desktopIdentity.publicKey));
		expect(decodePublicKey(connection.getSnapshot().peerIdentityKey ?? "")).toEqual(desktopIdentity.publicKey);

		approve?.(true);
		await waitFor(() => connection.getSnapshot().state === "online");
	});
});
