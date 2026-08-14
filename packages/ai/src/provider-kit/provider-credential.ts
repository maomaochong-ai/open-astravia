import { AI_ERROR_CODES, AIError, type Api, type Provider } from "../protocol/index.js";
import type { Model } from "../types.js";

export function requireProviderCredential<TApi extends Api>(
	model: Model<TApi>,
	credential: string | undefined,
	message = `No credentials configured for provider: ${model.provider}`,
): string {
	if (credential?.trim()) return credential;
	throw providerAuthenticationError(model, message);
}

export function providerAuthenticationError<TApi extends Api>(
	model: Model<TApi>,
	message: string,
	cause?: unknown,
): AIError {
	return new AIError(AI_ERROR_CODES.AUTHENTICATION_FAILED, message, {
		retryable: false,
		provider: model.provider,
		modelId: model.id,
		phase: "resolve",
		cause,
	});
}

/** Creates the stable error used when an explicitly requested model is absent. */
export function providerModelNotFoundError(provider: Provider, modelId: string): AIError {
	return new AIError(AI_ERROR_CODES.MODEL_NOT_FOUND, `Model ${provider}/${modelId} is not available`, {
		retryable: false,
		provider,
		modelId,
		phase: "resolve",
	});
}
