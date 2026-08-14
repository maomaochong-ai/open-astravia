import {
	AI_ERROR_CODES,
	AIError,
	type AIErrorOptions,
	type Api,
	type AssistantMessage,
	createAssistantMessage,
	isAIError,
	isRetryableProviderFailure,
} from "../protocol/index.js";
import type { Model } from "../types.js";
import { isContextOverflow } from "../utils/overflow.js";

const RESPONSE_BODY_PREVIEW_LIMIT = 1_000;
const SAFE_RESPONSE_HEADERS = new Set([
	"content-type",
	"retry-after",
	"x-request-id",
	"request-id",
	"trace-id",
	"cf-ray",
]);

/**
 * Converts arbitrary SDK/fetch failures into the one provider error contract used by AI,
 * Agent and Runtime. Raw request bodies and causes remain on the internal error only.
 */
export function normalizeProviderError<TApi extends Api>(error: unknown, model: Model<TApi>): AIError {
	if (isAIError(error)) return error;

	const statusCode = readStatusCode(error);
	const message = readMessage(error);
	const providerCode = readProviderCode(error);
	const responseHeaders = readResponseHeaders(error);
	const requestId = readRequestId(error, responseHeaders);
	const retryAfterMs = readRetryAfterMs(error, responseHeaders);
	const responseBodyPreview = readResponseBodyPreview(error);
	const url = readUrl(error);
	const phase = readPhase(error);
	const options: AIErrorOptions = {
		provider: model.provider,
		modelId: model.id,
		statusCode,
		requestId,
		providerCode,
		phase,
		url,
		responseHeaders,
		responseBodyPreview,
		retryAfterMs,
		cause: error,
	};

	if (isContextOverflow(createErrorMessage(model, message, statusCode), model.contextWindow)) {
		return new AIError(AI_ERROR_CODES.CONTEXT_OVERFLOW, message, { ...options, retryable: false });
	}
	if (statusCode === 401)
		return new AIError(AI_ERROR_CODES.AUTHENTICATION_FAILED, message, { ...options, retryable: false });
	if (
		statusCode === 402 ||
		(statusCode !== 429 && /insufficient[_ .-]?(quota|balance)|billing required|payment required/i.test(message))
	) {
		return new AIError(AI_ERROR_CODES.BILLING_REQUIRED, message, { ...options, retryable: false });
	}
	if (statusCode === 403)
		return new AIError(AI_ERROR_CODES.PERMISSION_DENIED, message, { ...options, retryable: false });
	if (statusCode === 404 && /model|deployment|engine/i.test(`${message} ${providerCode ?? ""}`)) {
		return new AIError(AI_ERROR_CODES.MODEL_NOT_FOUND, message, { ...options, retryable: false });
	}
	if (statusCode === 429) {
		return new AIError(AI_ERROR_CODES.RATE_LIMITED, message, {
			...options,
			retryable: isRetryableProviderFailure(message, statusCode),
		});
	}
	if (statusCode === 408) return new AIError(AI_ERROR_CODES.TIMEOUT, message, { ...options, retryable: true });
	if (statusCode === 400 || statusCode === 404 || statusCode === 409 || statusCode === 422) {
		return new AIError(AI_ERROR_CODES.INVALID_REQUEST, message, { ...options, retryable: false });
	}
	return new AIError(AI_ERROR_CODES.TRANSPORT_FAILED, message, {
		...options,
		retryable: isRetryableProviderFailure(message, statusCode),
	});
}

function createErrorMessage<TApi extends Api>(
	model: Model<TApi>,
	message: string,
	statusCode?: number,
): AssistantMessage {
	return createAssistantMessage(
		{ api: model.api, provider: model.provider, model: model.id },
		{
			stopReason: "error",
			errorMessage: statusCode === undefined ? message : `${statusCode} status code: ${message}`,
		},
	);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined;
}

function readStatusCode(error: unknown): number | undefined {
	const record = asRecord(error);
	if (!record) return undefined;
	for (const key of ["status", "statusCode"]) {
		if (typeof record[key] === "number") return record[key];
	}
	const response = asRecord(record.response);
	if (response && typeof response.status === "number") return response.status;
	const metadata = asRecord(record.$metadata);
	if (metadata && typeof metadata.httpStatusCode === "number") return metadata.httpStatusCode;
	return readStatusCode(record.cause);
}

function readMessage(error: unknown): string {
	const record = asRecord(error);
	if (record && typeof record.message === "string" && record.message.length > 0) return record.message;
	if (record && typeof record.error === "string" && record.error.length > 0) return record.error;
	return typeof error === "string" && error.length > 0 ? error : "Language model provider failed";
}

function readProviderCode(error: unknown): string | undefined {
	const record = asRecord(error);
	if (!record) return undefined;
	for (const key of ["code", "type", "errorCode", "error_type"]) {
		if (typeof record[key] === "string") return record[key];
	}
	const data = asRecord(record.data);
	if (data && typeof data.code === "string") return data.code;
	const body = asRecord(record.error);
	if (body && typeof body.code === "string") return body.code;
	return undefined;
}

function readResponseHeaders(error: unknown): Readonly<Record<string, string>> | undefined {
	const record = asRecord(error);
	const source = record?.responseHeaders ?? asRecord(record?.response)?.headers ?? record?.headers;
	if (source instanceof Headers) {
		const safe: Record<string, string> = {};
		source.forEach((value, key) => {
			if (SAFE_RESPONSE_HEADERS.has(key.toLowerCase())) safe[key.toLowerCase()] = value;
		});
		return Object.keys(safe).length === 0 ? undefined : safe;
	}
	const headers = asRecord(source);
	if (!headers) return undefined;
	const safe: Record<string, string> = {};
	for (const [key, value] of Object.entries(headers)) {
		if (SAFE_RESPONSE_HEADERS.has(key.toLowerCase()) && typeof value === "string") safe[key.toLowerCase()] = value;
	}
	return Object.keys(safe).length === 0 ? undefined : safe;
}

function readRequestId(error: unknown, headers?: Readonly<Record<string, string>>): string | undefined {
	const record = asRecord(error);
	for (const key of ["requestId", "request_id", "_request_id"]) {
		if (typeof record?.[key] === "string") return record[key] as string;
	}
	return headers?.["x-request-id"] ?? headers?.["request-id"] ?? headers?.["trace-id"];
}

function readResponseBodyPreview(error: unknown): string | undefined {
	const record = asRecord(error);
	const value = record?.responseBody ?? record?.body ?? asRecord(record?.response)?.body ?? record?.data;
	if (value === undefined) return undefined;
	let text: string;
	if (typeof value === "string") text = value;
	else {
		try {
			text = JSON.stringify(value) ?? String(value);
		} catch {
			text = "[unserializable response body]";
		}
	}
	return text.length > RESPONSE_BODY_PREVIEW_LIMIT ? `${text.slice(0, RESPONSE_BODY_PREVIEW_LIMIT)}…` : text;
}

function readRetryAfterMs(error: unknown, headers?: Readonly<Record<string, string>>): number | undefined {
	const record = asRecord(error);
	const direct = record?.retryAfterMs;
	if (typeof direct === "number" && direct >= 0) return direct;
	const retryAfter = headers?.["retry-after"];
	if (!retryAfter) return undefined;
	const seconds = Number(retryAfter);
	if (Number.isFinite(seconds)) return Math.max(0, seconds * 1_000);
	const date = Date.parse(retryAfter);
	return Number.isFinite(date) ? Math.max(0, date - Date.now()) : undefined;
}

function readUrl(error: unknown): string | undefined {
	const record = asRecord(error);
	const value = record?.url ?? asRecord(record?.request)?.url;
	if (typeof value !== "string") return undefined;
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

function readPhase(error: unknown): AIErrorOptions["phase"] {
	const record = asRecord(error);
	return record &&
		(record.phase === "resolve" ||
			record.phase === "request" ||
			record.phase === "response" ||
			record.phase === "stream" ||
			record.phase === "decode")
		? record.phase
		: undefined;
}
