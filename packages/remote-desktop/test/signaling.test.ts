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

	it("reports a drop only for an open socket and can connect again after it", async () => {
		const sockets: RemoteDesktopWebSocket[] = [];
		const closes: (string | undefined)[] = [];
		const signals: unknown[] = [];
		const signaling = new WebSocketRemoteDesktopSignaling(
			"wss://relay.test/v2/desktop/pairing_abcdefghijklmnopqrstuvwx/host#secret",
			() => {
				const socket = fakeSocket();
				sockets.push(socket);
				return socket;
			},
		);
		const handlers = {
			onSignal: (signal: unknown) => signals.push(signal),
			onClose: (reason?: string) => closes.push(reason),
		};

		const first = signaling.connect(handlers);
		sockets[0]?.onopen?.();
		await first;
		expect(signaling.connected).toBe(true);
		sockets[0]?.onclose?.({ reason: "Peer disconnected" });
		expect(closes).toEqual(["Peer disconnected"]);
		expect(signaling.connected).toBe(false);

		// The relay is still down: the attempt fails without another drop being reported.
		const failed = signaling.connect(handlers);
		sockets[1]?.onerror?.();
		sockets[1]?.onclose?.({});
		await expect(failed).rejects.toThrow("desktop signaling connection failed");
		expect(closes).toEqual(["Peer disconnected"]);

		const third = signaling.connect(handlers);
		sockets[2]?.onopen?.();
		await third;
		// A late event from an old socket does not touch the current one.
		sockets[0]?.onmessage?.({ data: '{"type":"peer_ready","protocolVersion":1}' });
		sockets[0]?.onclose?.({ reason: "late" });
		sockets[2]?.onmessage?.({ data: '{"type":"peer_ready","protocolVersion":1}' });
		expect(signals).toEqual([{ type: "peer_ready", protocolVersion: 1 }]);
		expect(closes).toEqual(["Peer disconnected"]);
		expect(signaling.connected).toBe(true);
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
