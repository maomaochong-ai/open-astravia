import type { Context, Model, SimpleStreamOptions, StreamFunction } from "../../types.js";
import type { AssistantMessageEventStream } from "../../utils/event-stream.js";
import { projectLanguageModelAdapter, projectLanguageModelSimpleAdapter } from "../legacy-adapter-stream.js";
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
	return projectLanguageModelSimpleAdapter(openAICompletionsAdapter, model, context, options);
};
