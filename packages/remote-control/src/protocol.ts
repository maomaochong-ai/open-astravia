import type {
	RemoteAck,
	RemoteCapabilities,
	RemoteError,
	RemoteEvent,
	RemoteFrame,
	RemoteHello,
	RemoteHelloAck,
	RemotePairingPending,
	RemotePeerStatus,
	RemoteRequest,
	RemoteResponse,
	RemoteResume,
	RemoteSealed,
	RemoteSessionFrame,
} from "./types.js";

const roles = new Set(["mobile", "desktop"]);
const requestMethods = new Set([
	"project.list",
	"session.list",
	"session.create",
	"session.open",
	"session.history",
	"session.prompt",
	"session.upload",
	"model.list",
	"session.configure",
	"session.rename",
	"session.pin",
	"session.delete",
	"session.respond",
	"session.abort",
	"session.resume",
	"diagnostics.snapshot",
]);
const eventNames = new Set([
	"device.status",
	"device.paired",
	"session.list",
	"session.state",
	"session.message",
	"session.tool",
	"session.input",
	"session.resync",
	"diagnostics.updated",
]);
const errorCodes = new Set([
	"invalid_frame",
	"unsupported_version",
	"unauthorized",
	"approval_rejected",
	"not_found",
	"busy",
	"request_timeout",
	"transport_closed",
	"internal_error",
]);

/** X25519 public key: 32 bytes as unpadded base64url. */
const PUBLIC_KEY_PATTERN = /^[A-Za-z0-9_-]{43}$/;
/** XChaCha20-Poly1305 nonce: 24 bytes as unpadded base64url. */
const NONCE_PATTERN = /^[A-Za-z0-9_-]{32}$/;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;
export const MAX_SEALED_CIPHERTEXT_CHARS = 1_400_000;

export class RemoteProtocolError extends Error {
	readonly code: RemoteError["code"] = "invalid_frame";

	constructor(message: string) {
		super(message);
		this.name = "RemoteProtocolError";
	}
}

function record(value: unknown): Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new RemoteProtocolError("frame must be an object");
	}
	return value as Record<string, unknown>;
}

function requiredString(value: unknown, field: string, maxLength = 512): string {
	if (typeof value !== "string" || value.length === 0 || value.length > maxLength) {
		throw new RemoteProtocolError(`${field} must be a non-empty string`);
	}
	return value;
}

function requiredBoolean(value: unknown, field: string): boolean {
	if (typeof value !== "boolean") throw new RemoteProtocolError(`${field} must be boolean`);
	return value;
}

function requiredInteger(value: unknown, field: string, minimum = 0): number {
	if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum) {
		throw new RemoteProtocolError(`${field} must be an integer >= ${minimum}`);
	}
	return value;
}

function publicKey(value: unknown, field: string): string {
	const text = requiredString(value, field, 64);
	if (!PUBLIC_KEY_PATTERN.test(text)) throw new RemoteProtocolError(`${field} must be a base64url X25519 key`);
	return text;
}

function requiredVersion(value: unknown): 2 {
	if (value !== 2) throw new RemoteProtocolError("unsupported protocol version");
	return 2;
}

function capabilities(value: unknown): RemoteCapabilities {
	const input = record(value);
	return {
		chat: requiredBoolean(input.chat, "capabilities.chat"),
		sessionRead: requiredBoolean(input.sessionRead, "capabilities.sessionRead"),
		fileRead: input.fileRead === undefined ? undefined : requiredBoolean(input.fileRead, "capabilities.fileRead"),
		fileWrite: input.fileWrite === undefined ? undefined : requiredBoolean(input.fileWrite, "capabilities.fileWrite"),
		terminal: input.terminal === undefined ? undefined : requiredBoolean(input.terminal, "capabilities.terminal"),
		screen: input.screen === undefined ? undefined : requiredBoolean(input.screen, "capabilities.screen"),
		input: input.input === undefined ? undefined : requiredBoolean(input.input, "capabilities.input"),
	};
}

function remoteError(value: unknown): RemoteError {
	const input = record(value);
	const code = requiredString(input.code, "error.code");
	if (!errorCodes.has(code)) throw new RemoteProtocolError("error.code is unsupported");
	return {
		code: code as RemoteError["code"],
		message: requiredString(input.message, "error.message"),
		retryable: requiredBoolean(input.retryable, "error.retryable"),
	};
}

export function decodeRemoteFrame(value: unknown): RemoteFrame {
	const input = record(value);
	const type = requiredString(input.type, "type");
	switch (type) {
		case "hello": {
			const role = requiredString(input.role, "role");
			if (!roles.has(role)) throw new RemoteProtocolError("role must be mobile or desktop");
			return {
				type,
				protocolVersion: requiredVersion(input.protocolVersion),
				role: role as RemoteHello["role"],
				deviceId: requiredString(input.deviceId, "deviceId", 256),
				deviceName: requiredString(input.deviceName, "deviceName", 128),
				capabilities: capabilities(input.capabilities),
				connectionId: requiredString(input.connectionId, "connectionId", 256),
				identityKey: publicKey(input.identityKey, "identityKey"),
				ephemeralKey: publicKey(input.ephemeralKey, "ephemeralKey"),
			} satisfies RemoteHello;
		}
		case "hello_ack":
			return {
				type,
				protocolVersion: requiredVersion(input.protocolVersion),
				connectionId: requiredString(input.connectionId, "connectionId", 256),
				peerDeviceId: requiredString(input.peerDeviceId, "peerDeviceId", 256),
				peerIdentityKey: publicKey(input.peerIdentityKey, "peerIdentityKey"),
				peerEphemeralKey: publicKey(input.peerEphemeralKey, "peerEphemeralKey"),
			} satisfies RemoteHelloAck;
		case "pairing_pending":
			return {
				type,
				connectionId: requiredString(input.connectionId, "connectionId", 256),
				peerDeviceId: requiredString(input.peerDeviceId, "peerDeviceId", 256),
				peerIdentityKey: publicKey(input.peerIdentityKey, "peerIdentityKey"),
			} satisfies RemotePairingPending;
		case "peer_status":
			return { type, online: requiredBoolean(input.online, "online") } satisfies RemotePeerStatus;
		case "sealed": {
			const nonce = requiredString(input.nonce, "nonce", 64);
			if (!NONCE_PATTERN.test(nonce)) throw new RemoteProtocolError("nonce must be a base64url 24-byte value");
			const ciphertext = requiredString(input.ciphertext, "ciphertext", MAX_SEALED_CIPHERTEXT_CHARS);
			if (!BASE64URL_PATTERN.test(ciphertext)) throw new RemoteProtocolError("ciphertext must be base64url");
			return { type, nonce, ciphertext } satisfies RemoteSealed;
		}
		case "request": {
			const method = requiredString(input.method, "method");
			if (!requestMethods.has(method)) throw new RemoteProtocolError("unsupported request method");
			return {
				type,
				requestId: requiredString(input.requestId, "requestId", 256),
				method: method as RemoteRequest["method"],
				sessionId: input.sessionId === undefined ? undefined : requiredString(input.sessionId, "sessionId", 256),
				payload: input.payload,
			} satisfies RemoteRequest;
		}
		case "response": {
			const success = requiredBoolean(input.success, "success");
			if (success && input.error !== undefined)
				throw new RemoteProtocolError("successful response must not include error");
			if (!success && input.error === undefined) throw new RemoteProtocolError("failed response must include error");
			return {
				type,
				requestId: requiredString(input.requestId, "requestId", 256),
				success,
				payload: input.payload,
				error: input.error === undefined ? undefined : remoteError(input.error),
			} satisfies RemoteResponse;
		}
		case "event": {
			const name = requiredString(input.name, "name");
			if (!eventNames.has(name)) throw new RemoteProtocolError("unsupported event name");
			return {
				type,
				eventId: requiredString(input.eventId, "eventId", 256),
				sequence: requiredInteger(input.sequence, "sequence", 1),
				name: name as RemoteEvent["name"],
				sessionId: input.sessionId === undefined ? undefined : requiredString(input.sessionId, "sessionId", 256),
				payload: input.payload,
			} satisfies RemoteEvent;
		}
		case "ack":
			return { type, sequence: requiredInteger(input.sequence, "sequence", 1) } satisfies RemoteAck;
		case "resume":
			return {
				type,
				lastEventSequence: requiredInteger(input.lastEventSequence, "lastEventSequence"),
			} satisfies RemoteResume;
		default:
			throw new RemoteProtocolError(`unsupported frame type: ${type}`);
	}
}

export function isHandshakeFrame(
	frame: RemoteFrame,
): frame is RemoteHello | RemoteHelloAck | RemotePairingPending | RemotePeerStatus {
	return (
		frame.type === "hello" ||
		frame.type === "hello_ack" ||
		frame.type === "pairing_pending" ||
		frame.type === "peer_status"
	);
}

export function isSessionFrame(frame: RemoteFrame): frame is RemoteSessionFrame {
	return !isHandshakeFrame(frame) && frame.type !== "sealed";
}

/** Decodes a frame that was carried inside a sealed envelope; handshake frames are never valid there. */
export function decodeSessionFrame(value: unknown): RemoteSessionFrame {
	const frame = decodeRemoteFrame(value);
	if (!isSessionFrame(frame)) throw new RemoteProtocolError(`${frame.type} must not be sealed`);
	return frame;
}

export function encodeRemoteFrame(frame: RemoteFrame): string {
	return `${JSON.stringify(frame)}\n`;
}

export function parseRemoteFrame(line: string): RemoteFrame {
	try {
		return decodeRemoteFrame(JSON.parse(line) as unknown);
	} catch (error) {
		if (error instanceof RemoteProtocolError) throw error;
		throw new RemoteProtocolError("frame is not valid JSON");
	}
}
