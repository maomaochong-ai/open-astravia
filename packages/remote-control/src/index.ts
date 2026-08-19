export { diagnosticsFromSnapshot, RemoteConnection } from "./connection.js";
export { FakeRelay } from "./fake-relay.js";
export type { FakeTransportOptions } from "./fake-transport.js";
export { FakeTransport } from "./fake-transport.js";
export { decodeRemoteFrame, encodeRemoteFrame, parseRemoteFrame, RemoteProtocolError } from "./protocol.js";
export type {
	RemoteAck,
	RemoteCapabilities,
	RemoteConnectionEvent,
	RemoteConnectionOptions,
	RemoteConnectionSnapshot,
	RemoteConnectionState,
	RemoteDiagnostics,
	RemoteError,
	RemoteEvent,
	RemoteEventName,
	RemoteFrame,
	RemoteHello,
	RemoteHelloAck,
	RemoteLogger,
	RemoteRequest,
	RemoteResponse,
	RemoteResume,
	RemoteRole,
	RemoteTransport,
	RemoteTransportHandlers,
} from "./types.js";
export { NOOP_REMOTE_LOGGER, REMOTE_PROTOCOL_VERSION } from "./types.js";
export type { RemoteWebSocket, RemoteWebSocketFactory } from "./websocket-transport.js";
export {
	PAIRING_PROTOCOL_PREFIX,
	REMOTE_WEBSOCKET_PROTOCOL,
	WebSocketRemoteTransport,
} from "./websocket-transport.js";
