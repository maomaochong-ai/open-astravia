import { type RemoteWebSocket, WebSocketRemoteTransport } from "@vetta/remote-control";
import type { TransportFactory } from "../types";

/**
 * React Native's WebSocket accepts a protocols array and `close(code, reason)`,
 * which is all the shared transport needs.
 */
export const createNativeTransport: TransportFactory = (url, options) =>
	new WebSocketRemoteTransport(url, {
		pairingSecret: options.pairingSecret,
		manual: options.manual,
		keepaliveIntervalMs: options.keepaliveIntervalMs,
		createSocket: (target, protocols) =>
			new WebSocket(target, protocols ? [...protocols] : undefined) as unknown as RemoteWebSocket,
	});
