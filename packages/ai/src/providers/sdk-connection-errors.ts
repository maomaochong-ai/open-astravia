import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { AIAbortedError, AIError, isAIError } from "../protocol/index.js";
import { normalizeProviderError } from "../provider-kit/index.js";
import type { Api, Model } from "../types.js";

/** SDK errors inherit Error.name; identify them before crossing the provider boundary. */
export function normalizeOpenAISdkError<TApi extends Api>(error: unknown, model: Model<TApi>): AIError {
	if (isAIError(error)) return error;
	const options = { provider: model.provider, modelId: model.id, cause: error };
	if (error instanceof OpenAI.APIUserAbortError) return new AIAbortedError(error.message, options);
	if (error instanceof OpenAI.APIConnectionTimeoutError)
		return new AIError("AI_TIMEOUT", error.message, { ...options, retryable: true });
	if (error instanceof OpenAI.APIConnectionError)
		return new AIError("AI_TRANSPORT_FAILED", error.message, { ...options, retryable: true });
	return normalizeProviderError(error, model);
}

export function normalizeAnthropicSdkError<TApi extends Api>(error: unknown, model: Model<TApi>): AIError {
	if (isAIError(error)) return error;
	const options = { provider: model.provider, modelId: model.id, cause: error };
	if (error instanceof Anthropic.APIUserAbortError) return new AIAbortedError(error.message, options);
	if (error instanceof Anthropic.APIConnectionTimeoutError)
		return new AIError("AI_TIMEOUT", error.message, { ...options, retryable: true });
	if (error instanceof Anthropic.APIConnectionError)
		return new AIError("AI_TRANSPORT_FAILED", error.message, { ...options, retryable: true });
	return normalizeProviderError(error, model);
}
