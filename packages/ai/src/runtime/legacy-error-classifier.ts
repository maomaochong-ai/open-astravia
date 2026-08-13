import { AIAbortedError, AIError, type Api, type AssistantMessage } from "../protocol/index.js";
import { normalizeProviderError } from "../provider-kit/provider-error.js";
import type { Model } from "../types.js";

export function classifyLegacyAssistantError<TApi extends Api>(message: AssistantMessage, model: Model<TApi>): AIError {
	const errorMessage = message.errorMessage ?? "Language model provider failed";
	if (message.stopReason === "aborted") {
		return new AIAbortedError(errorMessage, {
			provider: model.provider,
			modelId: model.id,
			phase: "response",
			metadata: { legacyStopReason: message.stopReason },
		});
	}

	// The legacy protocol only encoded status in the human-readable message. Keep this
	// parsing at the compatibility boundary, then use the canonical provider classifier.
	const statusCode = parseStatusCode(errorMessage);
	const normalized = normalizeProviderError(
		{
			message: errorMessage,
			status: statusCode,
			phase: "response",
		},
		model,
	);
	return new AIError(normalized.code, normalized.message, {
		retryable: normalized.retryable,
		statusCode: normalized.statusCode,
		provider: normalized.provider,
		modelId: normalized.modelId,
		phase: normalized.phase,
		metadata: { legacyStopReason: message.stopReason },
	});
}

export function normalizeLegacyProviderError<TApi extends Api>(error: unknown, model: Model<TApi>): AIError {
	return normalizeProviderError(error, model);
}

function parseStatusCode(message: string): number | undefined {
	const match = /(?:^|\D)(4\d\d|5\d\d)(?:\D|$)/.exec(message);
	return match?.[1] === undefined ? undefined : Number(match[1]);
}
