export type {
	RemoteDevicePaired,
	RemoteDeviceStatus,
	RemoteDiagnosticsSnapshot,
	RemoteEventPayloads,
	RemoteMessageEvent,
	RemoteProjectSummary,
	RemoteQuestionAnswer,
	RemoteQuestionItem,
	RemoteQuestionOption,
	RemoteQuestionRequest,
	RemoteRequestPayloads,
	RemoteResponsePayloads,
	RemoteSessionState,
	RemoteSessionStatus,
	RemoteSessionSummary,
	RemoteToolCallSummary,
	RemoteToolEvent,
	RemoteToolPhase,
	RemoteTranscriptEntry,
} from "./api.js";
export {
	readDevicePaired,
	readDeviceStatus,
	readMessageEvent,
	readProjectSummaries,
	readQuestionRequest,
	readSessionState,
	readSessionStatus,
	readSessionSummaries,
	readSessionSummary,
	readToolEvent,
	readTranscriptEntries,
} from "./api.js";
export { diagnosticsFromSnapshot, RemoteConnection } from "./connection.js";
export type { DeriveSessionKeysInput, RemoteRandomBytes, RemoteSessionKeys, SealOptions } from "./crypto.js";
export {
	bytesEqual,
	decodePublicKey,
	defaultRandomBytes,
	deriveSessionKeys,
	fromBase64Url,
	generateIdentityKeyPair,
	identityKeyPairFromSecret,
	openFrame,
	randomToken,
	sealFrame,
	sha256Hex,
	toBase64Url,
	verificationCode,
} from "./crypto.js";
export type { RemoteEventJournalOptions } from "./event-journal.js";
export { RemoteEventJournal } from "./event-journal.js";
export { FakeRelay } from "./fake-relay.js";
export type { FakeTransportOptions } from "./fake-transport.js";
export { FakeTransport } from "./fake-transport.js";
export type { RemotePairingInvite } from "./pairing-uri.js";
export {
	buildPairingUri,
	isValidHostPort,
	lanControlUrl,
	normalizeRelayBaseUrl,
	PAIRING_URI_HOST,
	PAIRING_URI_SCHEME,
	PAIRING_URI_VERSION,
	parsePairingUri,
	relayControlUrl,
} from "./pairing-uri.js";
export {
	decodeRemoteFrame,
	decodeSessionFrame,
	encodeRemoteFrame,
	isHandshakeFrame,
	isSessionFrame,
	MAX_SEALED_CIPHERTEXT_CHARS,
	parseRemoteFrame,
	RemoteProtocolError,
} from "./protocol.js";
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
	RemoteEventJournalPort,
	RemoteEventName,
	RemoteFrame,
	RemoteHandshakeFrame,
	RemoteHello,
	RemoteHelloAck,
	RemoteHelloDecision,
	RemoteIdentityKeyPair,
	RemoteLogger,
	RemotePairingPending,
	RemotePeerStatus,
	RemoteRequest,
	RemoteRequestMethod,
	RemoteResponse,
	RemoteResume,
	RemoteRole,
	RemoteSealed,
	RemoteSessionFrame,
	RemoteTransport,
	RemoteTransportHandlers,
} from "./types.js";
export { NOOP_REMOTE_LOGGER, REMOTE_PROTOCOL_VERSION } from "./types.js";
export type {
	OfferedProtocols,
	RemoteWebSocket,
	RemoteWebSocketFactory,
	WebSocketRemoteTransportOptions,
} from "./websocket-transport.js";
export {
	buildProtocols,
	MANUAL_PAIRING_PROTOCOL,
	PAIRING_PROTOCOL_PREFIX,
	parseOfferedProtocols,
	REMOTE_CLOSE_CODE_REJECTED,
	REMOTE_WEBSOCKET_PROTOCOL,
	WebSocketRemoteTransport,
} from "./websocket-transport.js";
