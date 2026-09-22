import { describe, expect, it } from "vitest";
import {
	MANUAL_PAIRING_PROTOCOL,
	PAIRING_PROTOCOL_PREFIX,
	parseOfferedProtocols,
	REMOTE_CLOSE_CODE_REJECTED,
	REMOTE_WEBSOCKET_PROTOCOL,
	type RemoteWebSocket,
	WebSocketRemoteTransport,
} from "../src/index.js";

describe("WebSocketRemoteTransport", () => {
	it("offers the pairing secret as a WebSocket protocol instead of putting it in the URL", async () => {
		let openedUrl: string | undefined;
		let openedProtocols: readonly string[] | undefined;
		const socket = fakeSocket();
		const transport = new WebSocketRemoteTransport("wss://relay.example/v2/relay/pairing-id/mobile", {
			pairingSecret: "pairing_secret_12345678901234567890",
			createSocket: (url, protocols) => {
				openedUrl = url;
				openedProtocols = protocols;
				queueMicrotask(() => socket.onopen?.());
				return socket;
			},
		});

		await transport.connect({ onFrame: () => undefined, onClose: () => undefined });

		expect(openedUrl).toBe("wss://relay.example/v2/relay/pairing-id/mobile");
		expect(openedProtocols).toEqual([
			REMOTE_WEBSOCKET_PROTOCOL,
			`${PAIRING_PROTOCOL_PREFIX}pairing_secret_12345678901234567890`,
		]);
	});

	it("declares a manual pairing when no secret is available", async () => {
		let openedProtocols: readonly string[] | undefined;
		const socket = fakeSocket();
		const transport = new WebSocketRemoteTransport("ws://192.168.1.2:43117/v2/lan/pairing-id", {
			manual: true,
			createSocket: (_url, protocols) => {
				openedProtocols = protocols;
				queueMicrotask(() => socket.onopen?.());
				return socket;
			},
		});
		await transport.connect({ onFrame: () => undefined, onClose: () => undefined });
		expect(openedProtocols).toEqual([REMOTE_WEBSOCKET_PROTOCOL, MANUAL_PAIRING_PROTOCOL]);
	});

	it("wraps an already open socket and forwards a rejection reason on close", async () => {
		const closes: Array<{ code?: number; reason?: string }> = [];
		const socket = {
			...fakeSocket(),
			readyState: 1,
			close: (code?: number, reason?: string) => closes.push({ code, reason }),
		};
		const transport = WebSocketRemoteTransport.fromOpenSocket(socket);
		const frames: string[] = [];
		await transport.connect({ onFrame: (frame) => frames.push(frame.type), onClose: () => undefined });
		socket.onmessage?.({ data: '{"type":"peer_status","online":true}\n' });
		expect(frames).toEqual(["peer_status"]);
		await transport.close("peer is not paired");
		expect(closes).toEqual([{ code: REMOTE_CLOSE_CODE_REJECTED, reason: "peer is not paired" }]);
	});

	it("parses the offered protocols on the accepting side", () => {
		expect(parseOfferedProtocols(`${REMOTE_WEBSOCKET_PROTOCOL}, ${PAIRING_PROTOCOL_PREFIX}secret`)).toEqual({
			remote: true,
			pairingSecret: "secret",
			manual: false,
		});
		expect(parseOfferedProtocols([REMOTE_WEBSOCKET_PROTOCOL, MANUAL_PAIRING_PROTOCOL])).toEqual({
			remote: true,
			pairingSecret: undefined,
			manual: true,
		});
		expect(parseOfferedProtocols(null)).toEqual({ remote: false, pairingSecret: undefined, manual: false });
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
