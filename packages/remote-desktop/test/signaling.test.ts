import { describe, expect, it } from "vitest";
import {
	REMOTE_DESKTOP_WEBSOCKET_PROTOCOL,
	type RemoteDesktopWebSocket,
	WebSocketRemoteDesktopSignaling,
} from "../src/index.js";

describe("desktop signaling websocket", () => {
	it("strips the pairing token from the URL", async () => {
		let url = "";
		let protocols: readonly string[] | undefined;
		const socket = fakeSocket();
		const signaling = new WebSocketRemoteDesktopSignaling(
			"wss://relay.test/v1/desktop/pairing_abcdefghijklmnopqrstuvwx/host#secret_abcdefghijklmnopqrstuvwxyz",
			(nextUrl, nextProtocols) => {
				url = nextUrl;
				protocols = nextProtocols;
				queueMicrotask(() => socket.onopen?.());
				return socket;
			},
		);

		await signaling.connect({ onSignal: () => undefined, onClose: () => undefined });

		expect(url).toBe("wss://relay.test/v1/desktop/pairing_abcdefghijklmnopqrstuvwx/host");
		expect(protocols).toEqual([REMOTE_DESKTOP_WEBSOCKET_PROTOCOL, "vetta.pairing.secret_abcdefghijklmnopqrstuvwxyz"]);
	});

	it("accepts the query-style pairing fragment used by QR pairing", async () => {
		let url = "";
		let protocols: readonly string[] | undefined;
		const socket = fakeSocket();
		const signaling = new WebSocketRemoteDesktopSignaling(
			"wss://relay.test/v1/desktop/pairing_abcdefghijklmnopqrstuvwx/viewer#pairing=mobile_resume&resume=ignored",
			(nextUrl, nextProtocols) => {
				url = nextUrl;
				protocols = nextProtocols;
				queueMicrotask(() => socket.onopen?.());
				return socket;
			},
		);

		await signaling.connect({ onSignal: () => undefined, onClose: () => undefined });

		expect(url).toBe("wss://relay.test/v1/desktop/pairing_abcdefghijklmnopqrstuvwx/viewer");
		expect(protocols).toEqual([REMOTE_DESKTOP_WEBSOCKET_PROTOCOL, "vetta.pairing.mobile_resume"]);
	});
});

function fakeSocket(): RemoteDesktopWebSocket {
	return {
		readyState: 0,
		onopen: null,
		onerror: null,
		onclose: null,
		onmessage: null,
		send: () => undefined,
		close: () => undefined,
	};
}
