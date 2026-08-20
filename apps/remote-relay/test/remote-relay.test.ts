import { SELF } from "cloudflare:test";
import { encodeRemoteFrame, parseRemoteFrame, type RemoteFrame } from "@vetta/remote-control";
import {
	encodeRemoteDesktopSignal,
	parseRemoteDesktopSignal,
	REMOTE_DESKTOP_WEBSOCKET_PROTOCOL,
} from "@vetta/remote-desktop/protocol";
import { describe, expect, it } from "vitest";
import { PAIRING_PROTOCOL_PREFIX, REMOTE_WEBSOCKET_PROTOCOL } from "../src/auth.js";

const pairingId = "pairing_0123456789abcdefghijklmno";
const pairingSecret = "secret_0123456789abcdefghijklmnopqrstuvwxyz";

describe("remote relay Worker", () => {
	it("exposes a non-cacheable health endpoint", async () => {
		const response = await SELF.fetch("https://relay.test/health");

		expect(response.status).toBe(200);
		expect(response.headers.get("Cache-Control")).toBe("no-store");
		expect(await response.json()).toEqual({ status: "ok", protocolVersion: 1 });
	});

	it("rejects missing credentials and prevents a mobile client from creating a room", async () => {
		const missing = await SELF.fetch(`https://relay.test/v1/relay/${pairingId}/desktop`, {
			headers: { Upgrade: "websocket", "Sec-WebSocket-Protocol": REMOTE_WEBSOCKET_PROTOCOL },
		});
		const mobileFirst = await upgrade("mobile", pairingSecret);

		expect(missing.status).toBe(401);
		expect(mobileFirst.response.status).toBe(401);
		expect(mobileFirst.socket).toBeNull();
	});

	it("authorizes one desktop and mobile then forwards validated frames", async () => {
		const desktop = await requireSocket(await upgrade("desktop", pairingSecret));
		const wrongMobile = await upgrade("mobile", `${pairingSecret}wrong`);
		expect(wrongMobile.response.status).toBe(401);

		const mobile = await requireSocket(await upgrade("mobile", pairingSecret));
		const desktopAck = nextFrame(desktop);
		const mobileAck = nextFrame(mobile);
		desktop.send(encodeRemoteFrame(hello("desktop", "desktop-1", "desktop-connection")));
		mobile.send(encodeRemoteFrame(hello("mobile", "phone-1", "mobile-connection")));

		await expect(desktopAck).resolves.toMatchObject({
			type: "hello_ack",
			connectionId: "desktop-connection",
			peerDeviceId: "phone-1",
		});
		await expect(mobileAck).resolves.toMatchObject({
			type: "hello_ack",
			connectionId: "mobile-connection",
			peerDeviceId: "desktop-1",
		});

		const forwarded = nextFrame(desktop);
		mobile.send(
			encodeRemoteFrame({
				type: "request",
				requestId: "request-1",
				method: "session.prompt",
				sessionId: "session-1",
				payload: { text: "not logged by relay" },
			}),
		);
		await expect(forwarded).resolves.toEqual({
			type: "request",
			requestId: "request-1",
			method: "session.prompt",
			sessionId: "session-1",
			payload: { text: "not logged by relay" },
		});

		desktop.close(1000, "test complete");
		mobile.close(1000, "test complete");
	});

	it("closes a client that sends malformed protocol data", async () => {
		const roomId = "pairing_invalid_frame_abcdefghijkl";
		const desktop = await requireSocket(await upgrade("desktop", pairingSecret, roomId));
		const mobile = await requireSocket(await upgrade("mobile", pairingSecret, roomId));
		const desktopAck = nextFrame(desktop);
		const mobileAck = nextFrame(mobile);
		desktop.send(encodeRemoteFrame(hello("desktop", "desktop-2", "desktop-connection-2")));
		mobile.send(encodeRemoteFrame(hello("mobile", "phone-2", "mobile-connection-2")));
		await Promise.all([desktopAck, mobileAck]);

		const close = nextClose(mobile);
		mobile.send('{"type":"request","requestId":"bad","method":"shell.exec"}\n');

		await expect(close).resolves.toMatchObject({ code: 4002 });
		desktop.close(1000, "test complete");
	});

	it("keeps WebRTC signaling separate and never relays input or media through the Worker", async () => {
		const roomId = "desktop_signaling_abcdefghijklmnop";
		const host = await requireSocket(await upgradeDesktop("host", pairingSecret, roomId));
		const peerReady = nextDesktopSignal(host);
		const viewer = await requireSocket(await upgradeDesktop("viewer", pairingSecret, roomId));
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
	});

	it("rejects clients that forge the relay-owned peer-ready event", async () => {
		const roomId = "desktop_ready_forgery_abcdefghijkl";
		const host = await requireSocket(await upgradeDesktop("host", pairingSecret, roomId));
		const closed = nextClose(host);

		host.send(encodeRemoteDesktopSignal({ type: "peer_ready", protocolVersion: 1 }));

		await expect(closed).resolves.toMatchObject({ code: 4002 });
	});
});

function hello(role: "mobile" | "desktop", deviceId: string, connectionId: string): RemoteFrame {
	return {
		type: "hello",
		protocolVersion: 1,
		role,
		deviceId,
		deviceName: deviceId,
		capabilities: { chat: true, sessionRead: true },
		connectionId,
	};
}

async function upgrade(role: "mobile" | "desktop", secret: string, roomId = pairingId) {
	const response = await SELF.fetch(`https://relay.test/v1/relay/${roomId}/${role}`, {
		headers: {
			Upgrade: "websocket",
			"Sec-WebSocket-Protocol": `${REMOTE_WEBSOCKET_PROTOCOL}, ${PAIRING_PROTOCOL_PREFIX}${secret}`,
		},
	});
	const socket = response.webSocket;
	socket?.accept();
	return { response, socket };
}

async function upgradeDesktop(role: "host" | "viewer", secret: string, roomId: string) {
	const response = await SELF.fetch(`https://relay.test/v1/desktop/${roomId}/${role}`, {
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
