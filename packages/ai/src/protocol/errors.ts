import type { Provider } from "./identity.js";

export const AI_ERROR_CODES = {
	AUTHENTICATION_FAILED: "AI_AUTHENTICATION_FAILED",
	PERMISSION_DENIED: "AI_PERMISSION_DENIED",
	RATE_LIMITED: "AI_RATE_LIMITED",
	CONTEXT_OVERFLOW: "AI_CONTEXT_OVERFLOW",
	INVALID_REQUEST: "AI_INVALID_REQUEST",
	RESPONSE_VALIDATION_FAILED: "AI_RESPONSE_VALIDATION_FAILED",
	STREAM_PROTOCOL_FAILED: "AI_STREAM_PROTOCOL_FAILED",
	TRANSPORT_FAILED: "AI_TRANSPORT_FAILED",
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
	metadata?: Readonly<Record<string, unknown>>;
	cause?: unknown;
}

export class AIError extends Error {
	readonly code: AIErrorCode;
	readonly retryable: boolean;
	readonly statusCode?: number;
	readonly provider?: Provider;
	readonly modelId?: string;
	readonly requestId?: string;
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
	return value instanceof AIError;
}
