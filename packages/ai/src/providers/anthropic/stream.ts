import type { Context, Model, SimpleStreamOptions, StreamFunction } from "../../types.js";
import { projectLanguageModelAdapter, projectLanguageModelSimpleAdapter } from "../legacy-adapter-stream.js";
import { anthropicAdapter } from "./adapter.js";
import type { AnthropicOptions } from "./options.js";

export const streamAnthropic: StreamFunction<"anthropic-messages", AnthropicOptions> = (
	model: Model<"anthropic-messages">,
	context: Context,
	options?: AnthropicOptions,
) => projectLanguageModelAdapter(anthropicAdapter, model, context, options);

export const streamSimpleAnthropic: StreamFunction<"anthropic-messages", SimpleStreamOptions> = (
	model: Model<"anthropic-messages">,
	context: Context,
	options?: SimpleStreamOptions,
) => {
	return projectLanguageModelSimpleAdapter(anthropicAdapter, model, context, options);
};
