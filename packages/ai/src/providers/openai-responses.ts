import { getEnvApiKey } from "../env-api-keys.js";
import type { Context, Model, SimpleStreamOptions, StreamFunction } from "../types.js";
import { openAIResponsesAdapter } from "./openai-responses/adapter.js";
import { projectResponsesAdapter } from "./openai-responses/legacy-stream.js";
import type { OpenAIResponsesOptions } from "./openai-responses/options.js";
import { buildBaseOptions } from "./simple-options.js";

export { openAIResponsesAdapter } from "./openai-responses/adapter.js";
export type { OpenAIResponsesOptions } from "./openai-responses/options.js";

export const streamOpenAIResponses: StreamFunction<"openai-responses", OpenAIResponsesOptions> = (
	model: Model<"openai-responses">,
	context: Context,
	options?: OpenAIResponsesOptions,
) => projectResponsesAdapter(openAIResponsesAdapter, model, context, options);

export const streamSimpleOpenAIResponses: StreamFunction<"openai-responses", SimpleStreamOptions> = (
	model: Model<"openai-responses">,
	context: Context,
	options?: SimpleStreamOptions,
) => {
	const apiKey = options?.apiKey || getEnvApiKey(model.provider);
	if (!apiKey) throw new Error(`No API key for provider: ${model.provider}`);
	return streamOpenAIResponses(model, context, {
		...buildBaseOptions(model, options, apiKey),
		reasoningEffort: options?.reasoning,
	} satisfies OpenAIResponsesOptions);
};
