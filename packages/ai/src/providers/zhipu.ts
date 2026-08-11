/**
 * Zhipu OpenAI Completions provider.
 *
 * Inherits from openai-completions with GLM thinking control:
 *   - thinking: { type: "enabled" | "disabled" }
 *   - reasoning_effort: native level passed through verbatim when thinking is enabled
 */

import type { Context, Model, SimpleStreamOptions, StreamFunction } from "../types.js";
import type { AssistantMessageEventStream } from "../utils/event-stream.js";
import type { OpenAICompletionsOptions } from "./openai-completions.js";
import {
	createOpenAICompatibleAdapter,
	streamOpenAICompletions,
	streamSimpleOpenAICompletions,
} from "./openai-completions.js";

const ZHIPU_COMPAT = { thinkingFormat: "zai" as const };

function withZhipuCompat(model: Model<"zhipu-openai-completions">): Model<"openai-completions"> {
	return {
		...model,
		api: "openai-completions" as const,
		provider: model.provider ?? "zhipu",
		compat: Object.assign({}, model.compat, ZHIPU_COMPAT),
	};
}

export const zhipuAdapter = createOpenAICompatibleAdapter("zhipu-openai-completions", withZhipuCompat);

export const streamZhipu: StreamFunction<"zhipu-openai-completions", OpenAICompletionsOptions> = (
	model: Model<"zhipu-openai-completions">,
	context: Context,
	options?: OpenAICompletionsOptions,
): AssistantMessageEventStream => {
	return streamOpenAICompletions(withZhipuCompat(model), context, options);
};

export const streamSimpleZhipu: StreamFunction<"zhipu-openai-completions", SimpleStreamOptions> = (
	model: Model<"zhipu-openai-completions">,
	context: Context,
	options?: SimpleStreamOptions,
): AssistantMessageEventStream => {
	return streamSimpleOpenAICompletions(withZhipuCompat(model), context, options);
};
