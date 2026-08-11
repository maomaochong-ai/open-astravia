export const KERNEL_ERROR_CODES = {
	SESSION_BUSY: "session_busy",
	SESSION_CLOSED: "session_closed",
	TURN_PROTOCOL: "turn_protocol",
	TURN_FAILED: "turn_failed",
	TURN_INTERRUPTED: "turn_interrupted",
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
