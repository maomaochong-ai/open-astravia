import type { RuntimeFailure } from "../failure-contract.js";

export const KERNEL_ERROR_CODES = {
	SESSION_BUSY: "session_busy",
	SESSION_CLOSED: "session_closed",
	TURN_PROTOCOL: "turn_protocol",
	TURN_FAILED: "turn_failed",
	TURN_INTERRUPTED: "turn_interrupted",
	TURN_PERSISTENCE: "turn_persistence",
	FEATURE_CONFIGURATION: "feature_configuration",
	FEATURE_CONFLICT: "feature_conflict",
	SNAPSHOT_PROVIDER_CLOSED: "snapshot_provider_closed",
} as const;

export type KernelErrorCode = (typeof KERNEL_ERROR_CODES)[keyof typeof KERNEL_ERROR_CODES];

export class KernelError extends Error {
	readonly code: KernelErrorCode;

	constructor(code: KernelErrorCode, message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = "KernelError";
		this.code = code;
	}
}

export class TurnPersistenceError extends KernelError {
	readonly turnId?: string;
	readonly failure?: RuntimeFailure;

	constructor(
		message: string,
		options?: ErrorOptions,
		context?: { readonly turnId?: string; readonly failure?: RuntimeFailure },
	) {
		super(KERNEL_ERROR_CODES.TURN_PERSISTENCE, message, options);
		this.name = "KernelError";
		this.turnId = context?.turnId;
		this.failure = context?.failure;
	}
}

/** Carries a model/tool execution failure through the TurnEngine exception boundary. */
export class TurnExecutionError extends Error {
	readonly failure: RuntimeFailure;

	constructor(failure: RuntimeFailure) {
		super(failure.message);
		this.name = failure.code;
		this.failure = failure;
	}
}

export function sessionBusyError(): KernelError {
	return new KernelError(KERNEL_ERROR_CODES.SESSION_BUSY, "Session already has an active turn");
}

export function sessionClosedError(): KernelError {
	return new KernelError(KERNEL_ERROR_CODES.SESSION_CLOSED, "Session is closing or closed");
}

export function turnProtocolError(message: string): KernelError {
	return new KernelError(KERNEL_ERROR_CODES.TURN_PROTOCOL, message);
}

export function featureConfigurationError(message: string): KernelError {
	return new KernelError(KERNEL_ERROR_CODES.FEATURE_CONFIGURATION, message);
}

export function featureConflictError(message: string): KernelError {
	return new KernelError(KERNEL_ERROR_CODES.FEATURE_CONFLICT, message);
}

export function snapshotProviderClosedError(): KernelError {
	return new KernelError(KERNEL_ERROR_CODES.SNAPSHOT_PROVIDER_CLOSED, "Runtime snapshot provider is closed");
}

export function turnPersistenceError(
	cause?: unknown,
	context?: { readonly turnId?: string; readonly failure?: RuntimeFailure },
): TurnPersistenceError {
	const detail = cause instanceof Error && cause.message ? ` Cause: ${cause.message}` : "";
	return new TurnPersistenceError(
		`Turn terminal state could not be persisted; session recovery is required.${detail}`,
		cause === undefined ? undefined : { cause },
		context,
	);
}

export function isTurnPersistenceError(value: unknown): value is TurnPersistenceError {
	return (
		value instanceof TurnPersistenceError ||
		(value instanceof KernelError && value.code === KERNEL_ERROR_CODES.TURN_PERSISTENCE)
	);
}
