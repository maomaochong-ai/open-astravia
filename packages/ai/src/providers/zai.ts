/**
 * Z.ai OpenAI Completions provider.
 *
 * Inherits from openai-completions with GLM/Z.ai thinking control:
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

const ZAI_COMPAT = { thinkingFormat: "zai" as const };

function withZaiCompat(model: Model<"zai-openai-completions">): Model<"openai-completions"> {
	return {
		...model,
		api: "openai-completions" as const,
		provider: model.provider ?? "zai",
		compat: Object.assign({}, model.compat, ZAI_COMPAT),
	};
}

export const zaiAdapter = createOpenAICompatibleAdapter("zai-openai-completions", withZaiCompat);

export const streamZai: StreamFunction<"zai-openai-completions", OpenAICompletionsOptions> = (
	model: Model<"zai-openai-completions">,
	context: Context,
	options?: OpenAICompletionsOptions,
): AssistantMessageEventStream => {
	return streamOpenAICompletions(withZaiCompat(model), context, options);
};

export const streamSimpleZai: StreamFunction<"zai-openai-completions", SimpleStreamOptions> = (
	model: Model<"zai-openai-completions">,
	context: Context,
	options?: SimpleStreamOptions,
): AssistantMessageEventStream => {
	return streamSimpleOpenAICompletions(withZaiCompat(model), context, options);
};
