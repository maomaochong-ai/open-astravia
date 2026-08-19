import type { RemoteDesktopSignal, RemoteInputMessage } from "./types.js";

export class RemoteDesktopProtocolError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "RemoteDesktopProtocolError";
	}
}

export function parseRemoteDesktopSignal(value: string): RemoteDesktopSignal {
	return decodeRemoteDesktopSignal(parseJson(value, "signal"));
}

export function decodeRemoteDesktopSignal(value: unknown): RemoteDesktopSignal {
	const input = exactRecord(value, signalFields(value));
	const type = text(input.type, "type", 32);
	if (input.protocolVersion !== 1) throw new RemoteDesktopProtocolError("unsupported desktop protocol version");
	const sessionId = text(input.sessionId, "sessionId", 128);
	if (type === "offer" || type === "answer") {
		return { type, protocolVersion: 1, sessionId, sdp: text(input.sdp, "sdp", 262_144) };
	}
	if (type === "ice") {
		const sdpMid = nullableText(input.sdpMid, "sdpMid", 128);
		const sdpMLineIndex = nullableInteger(input.sdpMLineIndex, "sdpMLineIndex", 0, 65_535);
		return {
			type,
			protocolVersion: 1,
			sessionId,
			candidate: text(input.candidate, "candidate", 8_192),
			sdpMid,
			sdpMLineIndex,
		};
	}
	if (type === "end") {
		const reason = text(input.reason, "reason", 32);
		if (!new Set(["completed", "revoked", "failed", "peer_closed"]).has(reason)) {
			throw new RemoteDesktopProtocolError("unsupported end reason");
		}
		return {
			type,
			protocolVersion: 1,
			sessionId,
			reason: reason as Extract<RemoteDesktopSignal, { type: "end" }>["reason"],
		};
	}
	throw new RemoteDesktopProtocolError("unsupported signal type");
}

export function encodeRemoteDesktopSignal(signal: RemoteDesktopSignal): string {
	decodeRemoteDesktopSignal(signal);
	return JSON.stringify(signal);
}

export function parseRemoteInputMessage(value: string): RemoteInputMessage {
	return decodeRemoteInputMessage(parseJson(value, "input message"));
}

export function decodeRemoteInputMessage(value: unknown): RemoteInputMessage {
	const input = exactRecord(value, inputFields(value));
	const type = text(input.type, "type", 32);
	const sequence = integer(input.sequence, "sequence", 1, Number.MAX_SAFE_INTEGER);
	if (type === "pointer.move") {
		return { type, sequence, x: normalized(input.x, "x"), y: normalized(input.y, "y") };
	}
	if (type === "pointer.button") {
		const button = text(input.button, "button", 16);
		const action = text(input.action, "action", 8);
		if (!new Set(["left", "middle", "right"]).has(button)) {
			throw new RemoteDesktopProtocolError("unsupported pointer button");
		}
		if (action !== "down" && action !== "up") throw new RemoteDesktopProtocolError("unsupported pointer action");
		return {
			type,
			sequence,
			x: normalized(input.x, "x"),
			y: normalized(input.y, "y"),
			button: button as "left" | "middle" | "right",
			action,
		};
	}
	if (type === "pointer.scroll") {
		return {
			type,
			sequence,
			deltaX: finiteNumber(input.deltaX, "deltaX", -4_096, 4_096),
			deltaY: finiteNumber(input.deltaY, "deltaY", -4_096, 4_096),
		};
	}
	if (type === "key") {
		const action = text(input.action, "action", 8);
		if (action !== "down" && action !== "up") throw new RemoteDesktopProtocolError("unsupported key action");
		return {
			type,
			sequence,
			code: text(input.code, "code", 64),
			action,
			modifiers: modifiers(input.modifiers),
		};
	}
	if (type === "heartbeat") {
		return { type, sequence, sentAt: integer(input.sentAt, "sentAt", 0, Number.MAX_SAFE_INTEGER) };
	}
	throw new RemoteDesktopProtocolError("unsupported input message type");
}

export function encodeRemoteInputMessage(message: RemoteInputMessage): string {
	decodeRemoteInputMessage(message);
	return JSON.stringify(message);
}

function parseJson(value: string, label: string): unknown {
	try {
		return JSON.parse(value) as unknown;
	} catch {
		throw new RemoteDesktopProtocolError(`${label} is not valid JSON`);
	}
}

function exactRecord(value: unknown, allowed: readonly string[]): Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new RemoteDesktopProtocolError("message must be an object");
	}
	const input = value as Record<string, unknown>;
	for (const key of Object.keys(input)) {
		if (!allowed.includes(key)) throw new RemoteDesktopProtocolError(`unsupported field: ${key}`);
	}
	return input;
}

function signalFields(value: unknown): readonly string[] {
	const type = typeof value === "object" && value !== null ? (value as Record<string, unknown>).type : undefined;
	if (type === "offer" || type === "answer") return ["type", "protocolVersion", "sessionId", "sdp"];
	if (type === "ice") return ["type", "protocolVersion", "sessionId", "candidate", "sdpMid", "sdpMLineIndex"];
	if (type === "end") return ["type", "protocolVersion", "sessionId", "reason"];
	return ["type", "protocolVersion", "sessionId"];
}

function inputFields(value: unknown): readonly string[] {
	const type = typeof value === "object" && value !== null ? (value as Record<string, unknown>).type : undefined;
	if (type === "pointer.move") return ["type", "sequence", "x", "y"];
	if (type === "pointer.button") return ["type", "sequence", "x", "y", "button", "action"];
	if (type === "pointer.scroll") return ["type", "sequence", "deltaX", "deltaY"];
	if (type === "key") return ["type", "sequence", "code", "action", "modifiers"];
	if (type === "heartbeat") return ["type", "sequence", "sentAt"];
	return ["type", "sequence"];
}

function text(value: unknown, field: string, maximum: number): string {
	if (typeof value !== "string" || value.length === 0 || value.length > maximum) {
		throw new RemoteDesktopProtocolError(`${field} must be a non-empty string of at most ${maximum} characters`);
	}
	return value;
}

function nullableText(value: unknown, field: string, maximum: number): string | null | undefined {
	if (value === undefined || value === null) return value;
	return text(value, field, maximum);
}

function integer(value: unknown, field: string, minimum: number, maximum: number): number {
	if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum || value > maximum) {
		throw new RemoteDesktopProtocolError(`${field} must be an integer between ${minimum} and ${maximum}`);
	}
	return value;
}

function nullableInteger(value: unknown, field: string, minimum: number, maximum: number): number | null | undefined {
	if (value === undefined || value === null) return value;
	return integer(value, field, minimum, maximum);
}

function normalized(value: unknown, field: string): number {
	return finiteNumber(value, field, 0, 1);
}

function finiteNumber(value: unknown, field: string, minimum: number, maximum: number): number {
	if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) {
		throw new RemoteDesktopProtocolError(`${field} must be between ${minimum} and ${maximum}`);
	}
	return value;
}

function modifiers(value: unknown): readonly ("alt" | "control" | "meta" | "shift")[] | undefined {
	if (value === undefined) return undefined;
	if (!Array.isArray(value) || value.length > 4) throw new RemoteDesktopProtocolError("modifiers must be an array");
	const allowed = new Set(["alt", "control", "meta", "shift"]);
	const parsed = value.map((item) => text(item, "modifier", 16));
	if (parsed.some((item) => !allowed.has(item)) || new Set(parsed).size !== parsed.length) {
		throw new RemoteDesktopProtocolError("modifiers contain unsupported or duplicate values");
	}
	return parsed as readonly ("alt" | "control" | "meta" | "shift")[];
}
