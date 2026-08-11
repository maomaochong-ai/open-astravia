import { getEnvApiKey } from "../../env-api-keys.js";
import type { Context, Model, SimpleStreamOptions, StreamFunction } from "../../types.js";
import type { AssistantMessageEventStream } from "../../utils/event-stream.js";
import { projectLanguageModelAdapter } from "../legacy-adapter-stream.js";
import { buildBaseOptions } from "../simple-options.js";
import { openAICompletionsAdapter } from "./adapter.js";
import type { OpenAICompletionsOptions } from "./options.js";

export const streamOpenAICompletions: StreamFunction<"openai-completions", OpenAICompletionsOptions> = (
	model: Model<"openai-completions">,
	context: Context,
	options?: OpenAICompletionsOptions,
): AssistantMessageEventStream => {
	return projectLanguageModelAdapter(openAICompletionsAdapter, model, context, options);
};

export const streamSimpleOpenAICompletions: StreamFunction<"openai-completions", SimpleStreamOptions> = (
	model: Model<"openai-completions">,
	context: Context,
	options?: SimpleStreamOptions,
): AssistantMessageEventStream => {
	const apiKey = options?.apiKey || getEnvApiKey(model.provider);
	if (!apiKey) throw new Error(`No API key for provider: ${model.provider}`);
	const base = buildBaseOptions(model, options, apiKey);
	return streamOpenAICompletions(model, context, {
		...base,
		reasoningEffort: options?.reasoning,
		toolChoice: (options as OpenAICompletionsOptions | undefined)?.toolChoice,
	} satisfies OpenAICompletionsOptions);
};
