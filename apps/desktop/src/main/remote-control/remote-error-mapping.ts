import { AI_ERROR_CODES, isAIError } from "@vetta/ai";
import type { RemoteError } from "@vetta/remote-control";

export class RemoteOperationError extends Error {
	constructor(
		readonly code: RemoteError["code"],
		message: string,
		readonly retryable = false,
	) {
		super(message);
		this.name = "RemoteOperationError";
	}
}

/** Maps desktop failures to protocol errors without leaking provider or filesystem detail to the phone. */
export function toRemoteError(error: unknown): RemoteError {
	if (error instanceof RemoteOperationError) return remoteError(error.code, error.message, error.retryable);
	if (isAIError(error)) return mapModelFailure(error.code, error.retryable);
	const wrapped = readWrappedFailure(error);
	if (wrapped) return mapModelFailure(wrapped.code, wrapped.retryable);
	const message = error instanceof Error ? error.message : "Remote desktop operation failed";
	const operationCode = isRecord(error) && typeof error.code === "string" ? error.code : undefined;
	switch (operationCode) {
		case "SESSION_NOT_FOUND":
		case "INVALID_SESSION_PATH":
			return remoteError("not_found", "Desktop session was not found", false);
		case "SESSION_BUSY":
		case "SESSION_LOCKED":
			return remoteError("busy", "Desktop session is already processing a turn", true);
		case "TURN_TIMEOUT":
			return remoteError("request_timeout", "Desktop conversation turn timed out", true);
		case "SESSION_READ_ONLY":
			return remoteError("unauthorized", "Desktop session is read-only", false);
		default:
			break;
	}
	if (message.includes("not found")) return remoteError("not_found", "Desktop session was not found", false);
	if (message.includes("already processing"))
		return remoteError("busy", "Desktop session is already processing a turn", true);
	if (message.includes("required"))
		return remoteError("invalid_frame", "Remote request is missing a required field", false);
	return remoteError("internal_error", "Remote desktop operation failed", false);
}

function readWrappedFailure(error: unknown): { code: string; retryable: boolean } | undefined {
	if (!isRecord(error) || !isRecord(error.details)) return undefined;
	const { code, retryable } = error.details;
	if (typeof code !== "string" || typeof retryable !== "boolean") return undefined;
	return { code, retryable };
}

function mapModelFailure(code: string, retryable: boolean): RemoteError {
	switch (code) {
		case AI_ERROR_CODES.AUTHENTICATION_FAILED:
		case AI_ERROR_CODES.PERMISSION_DENIED:
			return remoteError("unauthorized", "Desktop model authentication failed", false);
		case AI_ERROR_CODES.MODEL_NOT_FOUND:
			return remoteError("not_found", "Desktop model is not available", false);
		case AI_ERROR_CODES.RATE_LIMITED:
			return remoteError("busy", "Desktop model is rate limited", true);
		case AI_ERROR_CODES.TIMEOUT:
			return remoteError("request_timeout", "Desktop model request timed out", true);
		case AI_ERROR_CODES.BILLING_REQUIRED:
			return remoteError("internal_error", "Desktop model billing is unavailable", false);
		default:
			return remoteError("internal_error", "Desktop model request failed", retryable);
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function remoteError(code: RemoteError["code"], message: string, retryable: boolean): RemoteError {
	return { code, message, retryable };
}
