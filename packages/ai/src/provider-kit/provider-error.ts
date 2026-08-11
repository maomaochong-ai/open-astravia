import { AI_ERROR_CODES, AIError, type Api, type AssistantMessage } from "../protocol/index.js";
import type { Model } from "../types.js";
import { isContextOverflow } from "../utils/overflow.js";

export function normalizeProviderError<TApi extends Api>(error: unknown, model: Model<TApi>): AIError {
	if (error instanceof AIError) return error;

	const statusCode = readStatusCode(error);
	const message = error instanceof Error ? error.message : "Language model provider failed";
	const options = {
		provider: model.provider,
		modelId: model.id,
		statusCode,
		cause: error,
	};

	if (isContextOverflow(createErrorMessage(model, message, statusCode), model.contextWindow)) {
		return new AIError(AI_ERROR_CODES.CONTEXT_OVERFLOW, message, options);
	}
	if (statusCode === 401) return new AIError(AI_ERROR_CODES.AUTHENTICATION_FAILED, message, options);
	if (statusCode === 403) return new AIError(AI_ERROR_CODES.PERMISSION_DENIED, message, options);
	if (statusCode === 429) {
		return new AIError(AI_ERROR_CODES.RATE_LIMITED, message, { ...options, retryable: true });
	}
	if (statusCode === 400 || statusCode === 404 || statusCode === 422) {
		return new AIError(AI_ERROR_CODES.INVALID_REQUEST, message, options);
	}
	return new AIError(AI_ERROR_CODES.TRANSPORT_FAILED, message, {
		...options,
		retryable: statusCode !== undefined && statusCode >= 500,
	});
}

function createErrorMessage<TApi extends Api>(
	model: Model<TApi>,
	message: string,
	statusCode?: number,
): AssistantMessage {
	return {
		role: "assistant",
		content: [],
		api: model.api,
		provider: model.provider,
		model: model.id,
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "error",
		errorMessage: statusCode === undefined ? message : `${statusCode} status code: ${message}`,
		timestamp: Date.now(),
	};
}

function readStatusCode(error: unknown): number | undefined {
	if (typeof error !== "object" || error === null) return undefined;
	if ("status" in error && typeof error.status === "number") return error.status;
	if (!("$metadata" in error) || typeof error.$metadata !== "object" || error.$metadata === null) return undefined;
	if (!("httpStatusCode" in error.$metadata)) return undefined;
	return typeof error.$metadata.httpStatusCode === "number" ? error.$metadata.httpStatusCode : undefined;
}
