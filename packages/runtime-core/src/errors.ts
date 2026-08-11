import type { SessionError } from "./contracts.js";

export const RUNTIME_ERROR_CODES = {
	SESSION_NOT_FOUND: "SESSION_NOT_FOUND",
	SESSION_BUSY: "SESSION_BUSY",
	SESSION_LOCKED: "SESSION_LOCKED",
	INVALID_REQUEST: "INVALID_REQUEST",
	EXECUTION_MODE_SWITCH_BLOCKED: "EXECUTION_MODE_SWITCH_BLOCKED",
	INTERNAL_ERROR: "INTERNAL_ERROR",
} as const;

export function isSessionError(value: unknown): value is SessionError {
	if (typeof value !== "object" || value === null) return false;
	const candidate = value as Record<string, unknown>;
	return (
		typeof candidate.code === "string" &&
		typeof candidate.message === "string" &&
		typeof candidate.retryable === "boolean" &&
		(candidate.origin === "runtime" ||
			candidate.origin === "provider" ||
			candidate.origin === "tool" ||
			candidate.origin === "mcp")
	);
}

export function runtimeError(
	code: keyof typeof RUNTIME_ERROR_CODES,
	message: string,
	retryable: boolean,
	origin: SessionError["origin"] = "runtime",
	details?: unknown,
): SessionError {
	return {
		code: RUNTIME_ERROR_CODES[code],
		message,
		retryable,
		origin,
		details,
	};
}
