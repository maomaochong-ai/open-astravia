import { describe, expect, it } from "vitest";
import {
	BOOTSTRAP_PROTOCOL_PREFIX,
	PAIRING_PROTOCOL_PREFIX,
	REMOTE_WEBSOCKET_PROTOCOL,
	RESUME_PROTOCOL_PREFIX,
	type RemoteWebSocket,
	WebSocketRemoteTransport,
} from "../src/index.js";

describe("WebSocketRemoteTransport", () => {
	it("keeps the pairing token out of the network URL and offers it as a WebSocket protocol", async () => {
		let openedUrl: string | undefined;
		let openedProtocols: readonly string[] | undefined;
		const socket = fakeSocket();
		const transport = new WebSocketRemoteTransport(
			"wss://relay.example/v1/relay/pairing-id/mobile#pairing_secret_12345678901234567890",
			(url, protocols) => {
				openedUrl = url;
				openedProtocols = protocols;
				queueMicrotask(() => socket.onopen?.());
				return socket;
			},
		);

		await transport.connect({ onFrame: () => undefined, onClose: () => undefined });

		expect(openedUrl).toBe("wss://relay.example/v1/relay/pairing-id/mobile");
		expect(openedProtocols).toEqual([
			REMOTE_WEBSOCKET_PROTOCOL,
			`${PAIRING_PROTOCOL_PREFIX}pairing_secret_12345678901234567890`,
		]);
	});

	it("offers one-time bootstrap and resume credentials without exposing them in the URL", async () => {
		let openedUrl: string | undefined;
		let openedProtocols: readonly string[] | undefined;
		const socket = fakeSocket();
		const transport = new WebSocketRemoteTransport(
			"wss://relay.example/v1/relay/pairing-id/mobile#pairing=bootstrap-secret&bootstrap=desktop-bootstrap&resume=mobile-resume",
			(url, protocols) => {
				openedUrl = url;
				openedProtocols = protocols;
				queueMicrotask(() => socket.onopen?.());
				return socket;
			},
		);

		await transport.connect({ onFrame: () => undefined, onClose: () => undefined });

		expect(openedUrl).toBe("wss://relay.example/v1/relay/pairing-id/mobile");
		expect(openedProtocols).toEqual([
			REMOTE_WEBSOCKET_PROTOCOL,
			`${PAIRING_PROTOCOL_PREFIX}bootstrap-secret`,
			`${BOOTSTRAP_PROTOCOL_PREFIX}desktop-bootstrap`,
			`${RESUME_PROTOCOL_PREFIX}mobile-resume`,
		]);
	});
});

function fakeSocket(): RemoteWebSocket {
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
