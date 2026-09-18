import { getEnvApiKey } from "../../env-api-keys.js";
import { requireProviderCredential } from "../../provider-kit/index.js";
import type { Context, Model, SimpleStreamOptions, StreamFunction } from "../../types.js";
import type { AssistantMessageEventStream } from "../../utils/event-stream.js";
import { projectResponsesAdapter } from "../openai-responses/legacy-stream.js";
import { buildBaseOptions } from "../simple-options.js";
import { openAICodexResponsesAdapter } from "./adapter.js";
import type { OpenAICodexResponsesOptions } from "./options.js";

export const streamOpenAICodexResponses: StreamFunction<"openai-codex-responses", OpenAICodexResponsesOptions> = (
	model: Model<"openai-codex-responses">,
	context: Context,
	options?: OpenAICodexResponsesOptions,
): AssistantMessageEventStream => {
	return projectResponsesAdapter(openAICodexResponsesAdapter, model, context, options);
};

export const streamSimpleOpenAICodexResponses: StreamFunction<"openai-codex-responses", SimpleStreamOptions> = (
	model: Model<"openai-codex-responses">,
	context: Context,
	options?: SimpleStreamOptions,
): AssistantMessageEventStream => {
	const apiKey = requireProviderCredential(model, options?.apiKey || getEnvApiKey(model.provider));
	const base = buildBaseOptions(model, options, apiKey);
	return streamOpenAICodexResponses(model, context, {
		...base,
		reasoningEffort: options?.reasoning,
	} satisfies OpenAICodexResponsesOptions);
};
