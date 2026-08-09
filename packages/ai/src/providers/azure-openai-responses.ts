import { getEnvApiKey } from "../env-api-keys.js";
import { supportsXhigh } from "../models.js";
import type { Context, Model, SimpleStreamOptions, StreamFunction } from "../types.js";
import { azureOpenAIResponsesAdapter } from "./azure-openai-responses/adapter.js";
import type { AzureOpenAIResponsesOptions } from "./azure-openai-responses/options.js";
import { projectResponsesAdapter } from "./openai-responses/legacy-stream.js";
import { buildBaseOptions, clampReasoning } from "./simple-options.js";

export { azureOpenAIResponsesAdapter } from "./azure-openai-responses/adapter.js";
export type { AzureOpenAIResponsesOptions } from "./azure-openai-responses/options.js";

export const streamAzureOpenAIResponses: StreamFunction<"azure-openai-responses", AzureOpenAIResponsesOptions> = (
	model: Model<"azure-openai-responses">,
	context: Context,
	options?: AzureOpenAIResponsesOptions,
) => projectResponsesAdapter(azureOpenAIResponsesAdapter, model, context, options);

export const streamSimpleAzureOpenAIResponses: StreamFunction<"azure-openai-responses", SimpleStreamOptions> = (
	model: Model<"azure-openai-responses">,
	context: Context,
	options?: SimpleStreamOptions,
) => {
	const apiKey = options?.apiKey || getEnvApiKey(model.provider);
	if (!apiKey) throw new Error(`No API key for provider: ${model.provider}`);
	return streamAzureOpenAIResponses(model, context, {
		...buildBaseOptions(model, options, apiKey),
		reasoningEffort: supportsXhigh(model) ? options?.reasoning : clampReasoning(options?.reasoning),
	} satisfies AzureOpenAIResponsesOptions);
};
