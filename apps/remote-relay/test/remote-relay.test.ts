import { SELF } from "cloudflare:test";
import {
	encodeRemoteFrame,
	generateIdentityKeyPair,
	PAIRING_PROTOCOL_PREFIX,
	PEER_HASH_PROTOCOL_PREFIX,
	parseRemoteFrame,
	REMOTE_WEBSOCKET_PROTOCOL,
	type RemoteFrame,
	type RemoteHello,
	sha256Hex,
	toBase64Url,
} from "@vetta/remote-control";
import {
	encodeRemoteDesktopSignal,
	parseRemoteDesktopSignal,
	REMOTE_DESKTOP_WEBSOCKET_PROTOCOL,
} from "@vetta/remote-desktop/protocol";
import { describe, expect, it } from "vitest";

const desktopSecret = "desktop_secret_0123456789abcdefghijklmnopqrstuv";
const mobileSecret = "mobile_secret_0123456789abcdefghijklmnopqrstuvwx";
const mobileHash = sha256Hex(mobileSecret);
const nonce = "A".repeat(32);

describe("remote relay Worker (protocol v2)", () => {
	it("exposes a non-cacheable v2 health endpoint and no v1 route", async () => {
		const response = await SELF.fetch("https://relay.test/health");
		expect(response.status).toBe(200);
		expect(response.headers.get("Cache-Control")).toBe("no-store");
		expect(await response.json()).toEqual({ status: "ok", protocolVersion: 2 });

		const legacy = await SELF.fetch("https://relay.test/v1/relay/pairing_0123456789abcdefghijklmno/desktop", {
			headers: { Upgrade: "websocket", "Sec-WebSocket-Protocol": REMOTE_WEBSOCKET_PROTOCOL },
		});
		expect(legacy.status).toBe(404);
	});

	it("rejects missing protocols, phones before the desktop, and desktops without a peer hash", async () => {
		const room = "room_auth_0123456789abcdef";
		const missing = await SELF.fetch(`https://relay.test/v2/relay/${room}/desktop`, {
			headers: { Upgrade: "websocket", "Sec-WebSocket-Protocol": REMOTE_WEBSOCKET_PROTOCOL },
		});
		expect(missing.status).toBe(401);

		const mobileFirst = await upgrade("mobile", mobileSecret, room);
		expect(mobileFirst.response.status).toBe(401);
		expect(mobileFirst.socket).toBeNull();

		const desktopWithoutPeer = await upgrade("desktop", desktopSecret, room);
		expect(desktopWithoutPeer.response.status).toBe(401);

		const desktop = await requireSocket(await upgrade("desktop", desktopSecret, room, mobileHash));
		const wrongMobile = await upgrade("mobile", `${mobileSecret}wrong`, room);
		expect(wrongMobile.response.status).toBe(401);
		const otherDesktop = await upgrade("desktop", `${desktopSecret}other`, room, mobileHash);
		expect(otherDesktop.response.status).toBe(401);
		desktop.close(1000, "test complete");
	});

	it("acknowledges both sides with the peer's keys and forwards only sealed frames", async () => {
		const room = "room_pair_0123456789abcdef";
		const desktop = await requireSocket(await upgrade("desktop", desktopSecret, room, mobileHash));
		const mobile = await requireSocket(await upgrade("mobile", mobileSecret, room));
		const desktopHello = hello("desktop", "desktop-1", "desktop-connection");
		const mobileHello = hello("mobile", "phone-1", "mobile-connection");
		const desktopAck = nextFrame(desktop);
		const mobileAck = nextFrame(mobile);
		desktop.send(encodeRemoteFrame(desktopHello));
		mobile.send(encodeRemoteFrame(mobileHello));

		await expect(desktopAck).resolves.toEqual({
			type: "hello_ack",
			protocolVersion: 2,
			connectionId: "desktop-connection",
			peerDeviceId: "phone-1",
			peerIdentityKey: mobileHello.identityKey,
			peerEphemeralKey: mobileHello.ephemeralKey,
		});
		await expect(mobileAck).resolves.toEqual({
			type: "hello_ack",
			protocolVersion: 2,
			connectionId: "mobile-connection",
			peerDeviceId: "desktop-1",
			peerIdentityKey: desktopHello.identityKey,
			peerEphemeralKey: desktopHello.ephemeralKey,
		});

		const toDesktop = nextFrame(desktop);
		mobile.send(encodeRemoteFrame({ type: "sealed", nonce, ciphertext: "from-mobile" }));
		await expect(toDesktop).resolves.toEqual({ type: "sealed", nonce, ciphertext: "from-mobile" });
		const toMobile = nextFrame(mobile);
		desktop.send(encodeRemoteFrame({ type: "sealed", nonce, ciphertext: "from-desktop" }));
		await expect(toMobile).resolves.toEqual({ type: "sealed", nonce, ciphertext: "from-desktop" });

		const closed = nextClose(mobile);
		mobile.send(encodeRemoteFrame({ type: "request", requestId: "r1", method: "session.list" }));
		await expect(closed).resolves.toMatchObject({ code: 4002 });
		desktop.close(1000, "test complete");
	});

	it("reports the peer offline instead of closing, and re-acks the desktop when the phone returns", async () => {
		const room = "room_resume_0123456789abcd";
		const desktop = await requireSocket(await upgrade("desktop", desktopSecret, room, mobileHash));
		desktop.send(encodeRemoteFrame(hello("desktop", "desktop-2", "desktop-connection-2")));

		const offline = nextFrame(desktop);
		desktop.send(encodeRemoteFrame({ type: "sealed", nonce, ciphertext: "nobody-home" }));
		await expect(offline).resolves.toEqual({ type: "peer_status", online: false });

		const firstMobile = await requireSocket(await upgrade("mobile", mobileSecret, room));
		const firstAck = nextFrame(desktop);
		const firstHello = hello("mobile", "phone-2", "mobile-connection-a");
		firstMobile.send(encodeRemoteFrame(firstHello));
		await expect(firstAck).resolves.toMatchObject({ type: "hello_ack", peerEphemeralKey: firstHello.ephemeralKey });

		const gone = nextFrame(desktop);
		firstMobile.close(1000, "phone left");
		await expect(gone).resolves.toEqual({ type: "peer_status", online: false });

		const secondMobile = await requireSocket(await upgrade("mobile", mobileSecret, room));
		const secondAck = nextFrame(desktop);
		const secondHello = hello("mobile", "phone-2", "mobile-connection-b");
		secondMobile.send(encodeRemoteFrame(secondHello));
		await expect(secondAck).resolves.toMatchObject({
			type: "hello_ack",
			connectionId: "desktop-connection-2",
			peerEphemeralKey: secondHello.ephemeralKey,
		});
		desktop.close(1000, "test complete");
		secondMobile.close(1000, "test complete");
	});

	it("survives both peers closing together and accepts a fresh pair", async () => {
		const room = "room_close_race_0123456789";
		const desktop = await requireSocket(await upgrade("desktop", desktopSecret, room, mobileHash));
		const mobile = await requireSocket(await upgrade("mobile", mobileSecret, room));
		const desktopAck = nextFrame(desktop);
		const mobileAck = nextFrame(mobile);
		desktop.send(encodeRemoteFrame(hello("desktop", "desktop-race", "desktop-connection-race")));
		mobile.send(encodeRemoteFrame(hello("mobile", "phone-race", "mobile-connection-race")));
		await Promise.all([desktopAck, mobileAck]);

		desktop.close(1000, "desktop left");
		mobile.close(1000, "phone left");

		const replacementDesktop = await requireSocket(await upgrade("desktop", desktopSecret, room, mobileHash));
		const replacementMobile = await requireSocket(await upgrade("mobile", mobileSecret, room));
		const replacementDesktopAck = nextFrame(replacementDesktop);
		const replacementMobileAck = nextFrame(replacementMobile);
		replacementDesktop.send(encodeRemoteFrame(hello("desktop", "desktop-race", "desktop-connection-replacement")));
		replacementMobile.send(encodeRemoteFrame(hello("mobile", "phone-race", "mobile-connection-replacement")));
		await Promise.all([replacementDesktopAck, replacementMobileAck]);
		replacementDesktop.close(1000, "test complete");
		replacementMobile.close(1000, "test complete");
	});

	it("lets the registered desktop rotate the phone credential and rejects v1 hellos", async () => {
		const room = "room_rotate_0123456789abcd";
		const firstDesktop = await requireSocket(await upgrade("desktop", desktopSecret, room, mobileHash));
		firstDesktop.close(1000, "re-register");
		const rotatedSecret = "rotated_secret_0123456789abcdefghijklmnopqrstu";
		const desktop = await requireSocket(await upgrade("desktop", desktopSecret, room, sha256Hex(rotatedSecret)));
		expect((await upgrade("mobile", mobileSecret, room)).response.status).toBe(401);
		const mobile = await requireSocket(await upgrade("mobile", rotatedSecret, room));

		const closed = nextClose(mobile);
		mobile.send(`${JSON.stringify({ ...hello("mobile", "phone-3", "mobile-connection-3"), protocolVersion: 1 })}\n`);
		await expect(closed).resolves.toMatchObject({ code: 4002 });
		desktop.close(1000, "test complete");
	});

	it("keeps WebRTC signaling separate and never relays input or media through the Worker", async () => {
		const room = "room_signal_0123456789abcd";
		const control = await requireSocket(await upgrade("desktop", desktopSecret, room, mobileHash));
		const host = await requireSocket(await upgradeDesktop("host", desktopSecret, room));
		const peerReady = nextDesktopSignal(host);
		const viewer = await requireSocket(await upgradeDesktop("viewer", mobileSecret, room));
		await expect(peerReady).resolves.toEqual({ type: "peer_ready", protocolVersion: 1 });
		const offer = {
			type: "offer",
			protocolVersion: 1,
			sessionId: "desktop-session-1",
			sdp: "v=0\r\ns=Vetta E2E\r\n",
		} as const;
		const forwarded = nextDesktopSignal(viewer);
		host.send(encodeRemoteDesktopSignal(offer));
		await expect(forwarded).resolves.toEqual(offer);

		const closed = nextClose(viewer);
		viewer.send(JSON.stringify({ type: "pointer.move", sequence: 1, x: 0.5, y: 0.5 }));
		await expect(closed).resolves.toMatchObject({ code: 4002 });
		host.close(1000, "test complete");
		control.close(1000, "test complete");
	});

	it("rejects a WebRTC viewer whose secret is not the registered phone credential", async () => {
		const room = "room_viewer_0123456789abcd";
		const control = await requireSocket(await upgrade("desktop", desktopSecret, room, mobileHash));
		const rejected = await upgradeDesktop("viewer", `${mobileSecret}nope`, room);
		expect(rejected.response.status).toBe(401);
		control.close(1000, "test complete");
	});
});

function hello(role: "mobile" | "desktop", deviceId: string, connectionId: string): RemoteHello {
	return {
		type: "hello",
		protocolVersion: 2,
		role,
		deviceId,
		deviceName: deviceId,
		capabilities: { chat: true, sessionRead: true },
		connectionId,
		identityKey: toBase64Url(generateIdentityKeyPair().publicKey),
		ephemeralKey: toBase64Url(generateIdentityKeyPair().publicKey),
	};
}

async function upgrade(role: "mobile" | "desktop", secret: string, roomId: string, peerHash?: string) {
	const protocols = [REMOTE_WEBSOCKET_PROTOCOL, `${PAIRING_PROTOCOL_PREFIX}${secret}`];
	if (peerHash) protocols.push(`${PEER_HASH_PROTOCOL_PREFIX}${peerHash}`);
	const response = await SELF.fetch(`https://relay.test/v2/relay/${roomId}/${role}`, {
		headers: { Upgrade: "websocket", "Sec-WebSocket-Protocol": protocols.join(", ") },
	});
	const socket = response.webSocket;
	socket?.accept();
	return { response, socket };
}

async function upgradeDesktop(role: "host" | "viewer", secret: string, roomId: string) {
	const response = await SELF.fetch(`https://relay.test/v2/desktop/${roomId}/${role}`, {
		headers: {
			Upgrade: "websocket",
			"Sec-WebSocket-Protocol": `${REMOTE_DESKTOP_WEBSOCKET_PROTOCOL}, ${PAIRING_PROTOCOL_PREFIX}${secret}`,
		},
	});
	const socket = response.webSocket;
	socket?.accept();
	return { response, socket };
}

async function requireSocket(result: Awaited<ReturnType<typeof upgrade>>): Promise<WebSocket> {
	expect(result.response.status).toBe(101);
	if (!result.socket) throw new Error("relay response did not include a WebSocket");
	return result.socket;
}

function nextFrame(socket: WebSocket): Promise<RemoteFrame> {
	return withTimeout(
		new Promise((resolve) => {
			socket.addEventListener("message", (event) => resolve(parseRemoteFrame(String(event.data))), { once: true });
		}),
	);
}

function nextDesktopSignal(socket: WebSocket) {
	return withTimeout(
		new Promise((resolve) => {
			socket.addEventListener("message", (event) => resolve(parseRemoteDesktopSignal(String(event.data))), {
				once: true,
			});
		}),
	);
}

function nextClose(socket: WebSocket): Promise<{ readonly code: number; readonly reason: string }> {
	return withTimeout(
		new Promise((resolve) => {
			socket.addEventListener("close", (event) => resolve({ code: event.code, reason: event.reason }), {
				once: true,
			});
		}),
	);
}

async function withTimeout<T>(promise: Promise<T>): Promise<T> {
	return await Promise.race([
		promise,
		new Promise<never>((_, reject) => setTimeout(() => reject(new Error("relay test timed out")), 2_000)),
	]);
}
