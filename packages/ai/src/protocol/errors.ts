import type { Provider } from "./identity.js";

export const AI_ERROR_CODES = {
	AUTHENTICATION_FAILED: "AI_AUTHENTICATION_FAILED",
	PERMISSION_DENIED: "AI_PERMISSION_DENIED",
	BILLING_REQUIRED: "AI_BILLING_REQUIRED",
	RATE_LIMITED: "AI_RATE_LIMITED",
	CONTEXT_OVERFLOW: "AI_CONTEXT_OVERFLOW",
	MODEL_NOT_FOUND: "AI_MODEL_NOT_FOUND",
	INVALID_REQUEST: "AI_INVALID_REQUEST",
	RESPONSE_VALIDATION_FAILED: "AI_RESPONSE_VALIDATION_FAILED",
	STREAM_PROTOCOL_FAILED: "AI_STREAM_PROTOCOL_FAILED",
	TRANSPORT_FAILED: "AI_TRANSPORT_FAILED",
	TIMEOUT: "AI_TIMEOUT",
	ABORTED: "AI_ABORTED",
	UNSUPPORTED_CAPABILITY: "AI_UNSUPPORTED_CAPABILITY",
} as const;

export type AIErrorCode = (typeof AI_ERROR_CODES)[keyof typeof AI_ERROR_CODES];

export interface AIErrorOptions {
	retryable?: boolean;
	statusCode?: number;
	provider?: Provider;
	modelId?: string;
	requestId?: string;
	providerCode?: string;
	phase?: AIErrorPhase;
	url?: string;
	responseHeaders?: Readonly<Record<string, string>>;
	responseBodyPreview?: string;
	retryAfterMs?: number;
	metadata?: Readonly<Record<string, unknown>>;
	cause?: unknown;
}

export type AIErrorPhase = "resolve" | "request" | "response" | "stream" | "decode";

/** 可安全跨事件边界传递的 Provider 失败字段；不包含 cause 或原始请求/响应。 */
export interface AIErrorDetails {
	readonly code: AIErrorCode;
	readonly message: string;
	readonly retryable: boolean;
	readonly statusCode?: number;
	readonly provider?: Provider;
	readonly modelId?: string;
	readonly requestId?: string;
	readonly providerCode?: string;
	readonly phase?: AIErrorPhase;
	readonly url?: string;
	readonly responseHeaders?: Readonly<Record<string, string>>;
	readonly responseBodyPreview?: string;
	readonly retryAfterMs?: number;
}

const AI_ERROR_MARKER = Symbol.for("vetta.ai.error");
const SAFE_DIAGNOSTIC_HEADERS = new Set([
	"content-type",
	"retry-after",
	"x-request-id",
	"request-id",
	"trace-id",
	"cf-ray",
]);
const DIAGNOSTIC_BODY_LIMIT = 1_000;

export class AIError extends Error {
	readonly [AI_ERROR_MARKER] = true;
	readonly code: AIErrorCode;
	readonly retryable: boolean;
	readonly statusCode?: number;
	readonly provider?: Provider;
	readonly modelId?: string;
	readonly requestId?: string;
	readonly providerCode?: string;
	readonly phase?: AIErrorPhase;
	readonly url?: string;
	readonly responseHeaders?: Readonly<Record<string, string>>;
	readonly responseBodyPreview?: string;
	readonly retryAfterMs?: number;
	readonly metadata?: Readonly<Record<string, unknown>>;

	constructor(code: AIErrorCode, message: string, options: AIErrorOptions = {}) {
		super(message, options.cause === undefined ? undefined : { cause: options.cause });
		this.name = "AIError";
		this.code = code;
		this.retryable = options.retryable ?? false;
		this.statusCode = options.statusCode;
		this.provider = options.provider;
		this.modelId = options.modelId;
		this.requestId = options.requestId;
		this.providerCode = options.providerCode;
		this.phase = options.phase;
		this.url = options.url;
		this.responseHeaders = options.responseHeaders;
		this.responseBodyPreview = options.responseBodyPreview;
		this.retryAfterMs = options.retryAfterMs;
		this.metadata = options.metadata;
	}
}

export class AIStreamProtocolError extends AIError {
	constructor(message: string, options: Omit<AIErrorOptions, "retryable"> = {}) {
		super(AI_ERROR_CODES.STREAM_PROTOCOL_FAILED, message, { ...options, retryable: false });
		this.name = "AIStreamProtocolError";
	}
}

export class AIAbortedError extends AIError {
	constructor(message = "Model call was aborted", options: Omit<AIErrorOptions, "retryable"> = {}) {
		super(AI_ERROR_CODES.ABORTED, message, { ...options, retryable: false });
		this.name = "AIAbortedError";
	}
}

export function isAIError(value: unknown): value is AIError {
	return (
		value instanceof AIError ||
		(typeof value === "object" && value !== null && AI_ERROR_MARKER in value && value[AI_ERROR_MARKER] === true)
	);
}

export function isAIErrorDetails(value: unknown): value is AIErrorDetails {
	if (typeof value !== "object" || value === null) return false;
	const details = value as Record<string, unknown>;
	return (
		typeof details.code === "string" &&
		typeof details.message === "string" &&
		typeof details.retryable === "boolean" &&
		(details.statusCode === undefined || typeof details.statusCode === "number") &&
		(details.retryAfterMs === undefined || typeof details.retryAfterMs === "number")
	);
}

export function getAIErrorDetails(error: AIError): AIErrorDetails {
	const responseHeaders = sanitizeResponseHeaders(error.responseHeaders);
	const responseBodyPreview = sanitizeBodyPreview(error.responseBodyPreview);
	const url = sanitizeUrl(error.url);
	return {
		code: error.code,
		message: error.message,
		retryable: error.retryable,
		...(error.statusCode === undefined ? {} : { statusCode: error.statusCode }),
		...(error.provider === undefined ? {} : { provider: error.provider }),
		...(error.modelId === undefined ? {} : { modelId: error.modelId }),
		...(error.requestId === undefined ? {} : { requestId: error.requestId }),
		...(error.providerCode === undefined ? {} : { providerCode: error.providerCode }),
		...(error.phase === undefined ? {} : { phase: error.phase }),
		...(url === undefined ? {} : { url }),
		...(responseHeaders === undefined ? {} : { responseHeaders }),
		...(responseBodyPreview === undefined ? {} : { responseBodyPreview }),
		...(error.retryAfterMs === undefined ? {} : { retryAfterMs: error.retryAfterMs }),
	};
}

function sanitizeResponseHeaders(
	headers?: Readonly<Record<string, string>>,
): Readonly<Record<string, string>> | undefined {
	if (!headers) return undefined;
	const safe: Record<string, string> = {};
	for (const [key, value] of Object.entries(headers)) {
		if (SAFE_DIAGNOSTIC_HEADERS.has(key.toLowerCase()) && typeof value === "string") safe[key.toLowerCase()] = value;
	}
	return Object.keys(safe).length === 0 ? undefined : safe;
}

function sanitizeBodyPreview(value?: string): string | undefined {
	if (value === undefined) return undefined;
	return value.length > DIAGNOSTIC_BODY_LIMIT ? `${value.slice(0, DIAGNOSTIC_BODY_LIMIT)}…` : value;
}

function sanitizeUrl(value?: string): string | undefined {
	if (!value) return undefined;
	try {
		const url = new URL(value);
		url.username = "";
		url.password = "";
		url.search = "";
		url.hash = "";
		return url.toString();
	} catch {
		return undefined;
	}
}

export function createAIErrorFromDetails(details: AIErrorDetails): AIError {
	return new AIError(details.code, details.message, {
		retryable: details.retryable,
		statusCode: details.statusCode,
		provider: details.provider,
		modelId: details.modelId,
		requestId: details.requestId,
		providerCode: details.providerCode,
		phase: details.phase,
		url: details.url,
		responseHeaders: details.responseHeaders,
		responseBodyPreview: details.responseBodyPreview,
		retryAfterMs: details.retryAfterMs,
	});
}

/**
 * Classifies provider failures for automatic retry without inspecting provider-specific
 * SDK classes at the Agent/Runtime boundary. Quota and billing failures are deliberately
 * non-retryable even when a gateway reports them as HTTP 429.
 */
export function isRetryableProviderFailure(message: string, statusCode?: number): boolean {
	if (
		/额度已用尽|额度不足|窗口额度|余额不足|insufficient[_ .-]?quota|insufficient[_ .-]?balance|quota[_ .-]?(exhausted|exceeded)|out of quota|billing required|payment required|account suspended/i.test(
			message,
		)
	) {
		return false;
	}
	if (statusCode === 408 || statusCode === 409 || statusCode === 429) return true;
	return statusCode !== undefined && statusCode >= 500;
}
