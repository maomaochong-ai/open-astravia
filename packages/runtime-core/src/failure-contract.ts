export type RuntimeFailureOrigin = "runtime" | "provider" | "tool" | "extension";

/** Safe process-owner fields for a generic Session ownership conflict. */
export interface RuntimeFailureLockHolder {
	readonly pid: number;
	readonly hostname: string;
	readonly openedAt: string;
}

/** Safe diagnostic fields shared by persisted Turn failures and host events. */
export interface RuntimeFailureDetails {
	readonly statusCode?: number;
	readonly provider?: string;
	readonly modelId?: string;
	readonly requestId?: string;
	readonly providerCode?: string;
	readonly phase?: "resolve" | "request" | "response" | "stream" | "decode";
	readonly url?: string;
	readonly responseHeaders?: Readonly<Record<string, string>>;
	readonly responseBodyPreview?: string;
	readonly retryAfterMs?: number;
	readonly lockHolder?: RuntimeFailureLockHolder;
}

/** Current in-process failure contract. */
export interface RuntimeFailure {
	readonly code: string;
	readonly message: string;
	readonly retryable: boolean;
	readonly origin: RuntimeFailureOrigin;
	readonly details?: RuntimeFailureDetails;
}

/** Persisted records predate structured retry and origin fields, so they remain optional on read. */
export interface RecordedRuntimeFailure {
	readonly code: string;
	readonly message: string;
	readonly retryable?: boolean;
	readonly origin?: RuntimeFailureOrigin;
	readonly details?: RuntimeFailureDetails;
}

/**
 * Narrows an untrusted boundary value to the safe Runtime failure contract.
 * Error messages are retained for execution/event compatibility; Observation
 * producers must project only code/origin and other explicitly safe fields.
 */
export function readRuntimeFailure(value: unknown): RuntimeFailure | undefined {
	if (!value || typeof value !== "object") return undefined;
	const candidate = value as Record<string, unknown>;
	if (
		typeof candidate.code !== "string" ||
		typeof candidate.message !== "string" ||
		typeof candidate.retryable !== "boolean" ||
		!isRuntimeFailureOrigin(candidate.origin)
	) {
		return undefined;
	}
	const details = readRuntimeFailureDetails(candidate.details);
	if (candidate.details !== undefined && !details) return undefined;
	return {
		code: candidate.code,
		message: candidate.message,
		retryable: candidate.retryable,
		origin: candidate.origin,
		...(details ? { details } : {}),
	};
}

function readRuntimeFailureDetails(value: unknown): RuntimeFailureDetails | undefined {
	if (!value || typeof value !== "object") return undefined;
	const candidate = value as Record<string, unknown>;
	if (
		(candidate.statusCode !== undefined && typeof candidate.statusCode !== "number") ||
		(candidate.provider !== undefined && typeof candidate.provider !== "string") ||
		(candidate.modelId !== undefined && typeof candidate.modelId !== "string") ||
		(candidate.requestId !== undefined && typeof candidate.requestId !== "string") ||
		(candidate.providerCode !== undefined && typeof candidate.providerCode !== "string") ||
		(candidate.phase !== undefined && !isRuntimeFailurePhase(candidate.phase)) ||
		(candidate.url !== undefined && typeof candidate.url !== "string") ||
		(candidate.responseHeaders !== undefined && !isStringRecord(candidate.responseHeaders)) ||
		(candidate.responseBodyPreview !== undefined && typeof candidate.responseBodyPreview !== "string") ||
		(candidate.retryAfterMs !== undefined && typeof candidate.retryAfterMs !== "number") ||
		(candidate.lockHolder !== undefined && !isRuntimeFailureLockHolder(candidate.lockHolder))
	) {
		return undefined;
	}
	return {
		...(candidate.statusCode === undefined ? {} : { statusCode: candidate.statusCode as number }),
		...(candidate.provider === undefined ? {} : { provider: candidate.provider as string }),
		...(candidate.modelId === undefined ? {} : { modelId: candidate.modelId as string }),
		...(candidate.requestId === undefined ? {} : { requestId: candidate.requestId as string }),
		...(candidate.providerCode === undefined ? {} : { providerCode: candidate.providerCode as string }),
		...(candidate.phase === undefined ? {} : { phase: candidate.phase as RuntimeFailureDetails["phase"] }),
		...(candidate.url === undefined ? {} : { url: candidate.url as string }),
		...(candidate.responseHeaders === undefined
			? {}
			: { responseHeaders: candidate.responseHeaders as Readonly<Record<string, string>> }),
		...(candidate.responseBodyPreview === undefined
			? {}
			: { responseBodyPreview: candidate.responseBodyPreview as string }),
		...(candidate.retryAfterMs === undefined ? {} : { retryAfterMs: candidate.retryAfterMs as number }),
		...(candidate.lockHolder === undefined ? {} : { lockHolder: candidate.lockHolder as RuntimeFailureLockHolder }),
	};
}

function isRuntimeFailureLockHolder(value: unknown): value is RuntimeFailureLockHolder {
	if (!value || typeof value !== "object") return false;
	const candidate = value as Record<string, unknown>;
	return (
		typeof candidate.pid === "number" &&
		typeof candidate.hostname === "string" &&
		typeof candidate.openedAt === "string"
	);
}

function isRuntimeFailureOrigin(value: unknown): value is RuntimeFailureOrigin {
	return value === "runtime" || value === "provider" || value === "tool" || value === "extension";
}

function isRuntimeFailurePhase(value: unknown): value is NonNullable<RuntimeFailureDetails["phase"]> {
	return (
		value === "resolve" || value === "request" || value === "response" || value === "stream" || value === "decode"
	);
}

function isStringRecord(value: unknown): value is Readonly<Record<string, string>> {
	return !!value && typeof value === "object" && Object.values(value).every((entry) => typeof entry === "string");
}
