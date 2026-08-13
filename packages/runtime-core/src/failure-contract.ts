export type RuntimeFailureOrigin = "runtime" | "provider" | "tool" | "mcp";

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
