import type {
	RemoteAck,
	RemoteCapabilities,
	RemoteError,
	RemoteEvent,
	RemoteFrame,
	RemoteHello,
	RemoteHelloAck,
	RemoteRequest,
	RemoteResponse,
	RemoteResume,
} from "./types.js";

const roles = new Set(["mobile", "desktop"]);
const requestMethods = new Set([
	"session.list",
	"session.open",
	"session.prompt",
	"session.abort",
	"session.resume",
	"diagnostics.snapshot",
]);
const eventNames = new Set([
	"device.status",
	"session.state",
	"session.message",
	"session.tool",
	"diagnostics.updated",
]);

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

function requiredString(value: unknown, field: string): string {
	if (typeof value !== "string" || value.length === 0 || value.length > 512) {
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
	const code = requiredString(input.code, "error.code") as RemoteError["code"];
	if (
		!new Set([
			"invalid_frame",
			"unsupported_version",
			"unauthorized",
			"not_found",
			"busy",
			"request_timeout",
			"transport_closed",
			"internal_error",
		]).has(code)
	) {
		throw new RemoteProtocolError("error.code is unsupported");
	}
	return {
		code,
		message: requiredString(input.message, "error.message"),
		retryable: requiredBoolean(input.retryable, "error.retryable"),
	};
}

export function decodeRemoteFrame(value: unknown): RemoteFrame {
	const input = record(value);
	const type = requiredString(input.type, "type");
	if (type === "hello") {
		if (input.protocolVersion !== 1) throw new RemoteProtocolError("unsupported protocol version");
		const role = requiredString(input.role, "role");
		if (!roles.has(role)) throw new RemoteProtocolError("role must be mobile or desktop");
		return {
			type,
			protocolVersion: 1,
			role: role as RemoteHello["role"],
			deviceId: requiredString(input.deviceId, "deviceId"),
			deviceName: requiredString(input.deviceName, "deviceName"),
			capabilities: capabilities(input.capabilities),
			connectionId: requiredString(input.connectionId, "connectionId"),
		};
	}
	if (type === "hello_ack") {
		if (input.protocolVersion !== 1) throw new RemoteProtocolError("unsupported protocol version");
		return {
			type,
			protocolVersion: 1,
			connectionId: requiredString(input.connectionId, "connectionId"),
			peerDeviceId: requiredString(input.peerDeviceId, "peerDeviceId"),
		} satisfies RemoteHelloAck;
	}
	if (type === "request") {
		const method = requiredString(input.method, "method");
		if (!requestMethods.has(method)) throw new RemoteProtocolError("unsupported request method");
		return {
			type,
			requestId: requiredString(input.requestId, "requestId"),
			method: method as RemoteRequest["method"],
			sessionId: input.sessionId === undefined ? undefined : requiredString(input.sessionId, "sessionId"),
			payload: input.payload,
		};
	}
	if (type === "response") {
		const success = requiredBoolean(input.success, "success");
		if (success && input.error !== undefined)
			throw new RemoteProtocolError("successful response must not include error");
		if (!success && input.error === undefined) throw new RemoteProtocolError("failed response must include error");
		return {
			type,
			requestId: requiredString(input.requestId, "requestId"),
			success,
			payload: input.payload,
			error: input.error === undefined ? undefined : remoteError(input.error),
		} satisfies RemoteResponse;
	}
	if (type === "event") {
		const name = requiredString(input.name, "name");
		if (!eventNames.has(name)) throw new RemoteProtocolError("unsupported event name");
		return {
			type,
			eventId: requiredString(input.eventId, "eventId"),
			sequence: requiredInteger(input.sequence, "sequence", 1),
			name: name as RemoteEvent["name"],
			sessionId: input.sessionId === undefined ? undefined : requiredString(input.sessionId, "sessionId"),
			payload: input.payload,
		} satisfies RemoteEvent;
	}
	if (type === "ack") return { type, sequence: requiredInteger(input.sequence, "sequence", 1) } satisfies RemoteAck;
	if (type === "resume")
		return {
			type,
			lastEventSequence: requiredInteger(input.lastEventSequence, "lastEventSequence"),
		} satisfies RemoteResume;
	throw new RemoteProtocolError(`unsupported frame type: ${type}`);
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
