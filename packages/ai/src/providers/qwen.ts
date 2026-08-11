/**
 * Qwen OpenAI Completions provider.
 *
 * Inherits from openai-completions with Qwen-specific thinking control:
 *   - enable_thinking: boolean  (toggle thinking on/off; false disables thinking)
 *   - reasoning_effort: "minimal" | "low" | "medium" | "high"  (effort level; Qwen has no "none")
 *
 * Both parameters are sent together for maximum compatibility.
 * Models registered with api "qwen-openai-completions" automatically get
 * thinkingFormat "qwen" injected — no manual compat config needed.
 */

import type { Context, Model, SimpleStreamOptions, StreamFunction } from "../types.js";
import type { AssistantMessageEventStream } from "../utils/event-stream.js";
import type { OpenAICompletionsOptions } from "./openai-completions.js";
import {
	createOpenAICompatibleAdapter,
	streamOpenAICompletions,
	streamSimpleOpenAICompletions,
} from "./openai-completions.js";

const QWEN_COMPAT = { thinkingFormat: "qwen" as const, supportsDeveloperRole: false };

function withQwenCompat(model: Model<"qwen-openai-completions">): Model<"openai-completions"> {
	return {
		...model,
		api: "openai-completions" as const,
		compat: Object.assign({}, model.compat, QWEN_COMPAT),
	};
}

export const qwenAdapter = createOpenAICompatibleAdapter("qwen-openai-completions", withQwenCompat);

export const streamQwen: StreamFunction<"qwen-openai-completions", OpenAICompletionsOptions> = (
	model: Model<"qwen-openai-completions">,
	context: Context,
	options?: OpenAICompletionsOptions,
): AssistantMessageEventStream => {
	return streamOpenAICompletions(withQwenCompat(model), context, options);
};

export const streamSimpleQwen: StreamFunction<"qwen-openai-completions", SimpleStreamOptions> = (
	model: Model<"qwen-openai-completions">,
	context: Context,
	options?: SimpleStreamOptions,
): AssistantMessageEventStream => {
	return streamSimpleOpenAICompletions(withQwenCompat(model), context, options);
};
