import { AI_ERROR_CODES, AIAbortedError, AIError, type Api, type AssistantMessage } from "../protocol/index.js";
import { normalizeProviderError } from "../provider-kit/provider-error.js";
import type { Model } from "../types.js";
import { isContextOverflow } from "../utils/overflow.js";

export function classifyLegacyAssistantError<TApi extends Api>(message: AssistantMessage, model: Model<TApi>): AIError {
	const errorMessage = message.errorMessage ?? "Language model provider failed";
	const statusCode = parseStatusCode(errorMessage);
	const options = {
		provider: model.provider,
		modelId: model.id,
		statusCode,
		metadata: { legacyStopReason: message.stopReason },
	};
	if (message.stopReason === "aborted") return new AIAbortedError(errorMessage, options);
	if (isContextOverflow(message, model.contextWindow)) {
		return new AIError(AI_ERROR_CODES.CONTEXT_OVERFLOW, errorMessage, options);
	}
	if (statusCode === 401) return new AIError(AI_ERROR_CODES.AUTHENTICATION_FAILED, errorMessage, options);
	if (statusCode === 403) return new AIError(AI_ERROR_CODES.PERMISSION_DENIED, errorMessage, options);
	if (statusCode === 429) {
		return new AIError(AI_ERROR_CODES.RATE_LIMITED, errorMessage, { ...options, retryable: true });
	}
	if (statusCode === 400 || statusCode === 404 || statusCode === 422) {
		return new AIError(AI_ERROR_CODES.INVALID_REQUEST, errorMessage, options);
	}
	return new AIError(AI_ERROR_CODES.TRANSPORT_FAILED, errorMessage, {
		...options,
		retryable: statusCode !== undefined && statusCode >= 500,
	});
}

export function normalizeLegacyProviderError<TApi extends Api>(error: unknown, model: Model<TApi>): AIError {
	return normalizeProviderError(error, model);
}

function parseStatusCode(message: string): number | undefined {
	const match = /(?:^|\D)(4\d\d|5\d\d)(?:\D|$)/.exec(message);
	return match?.[1] === undefined ? undefined : Number(match[1]);
}
