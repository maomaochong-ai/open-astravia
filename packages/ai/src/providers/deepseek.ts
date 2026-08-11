/**
 * DeepSeek OpenAI Completions provider.
 *
 * Inherits from openai-completions with DeepSeek-specific thinking control on the
 * v4 unified models (deepseek-v4-flash / deepseek-v4-pro):
 *   - thinking: { type: "enabled" | "disabled", reasoning_effort }
 *   - reasoning_effort accepts "high" | "max" (passed through per the model's configured levels)
 *
 * DeepSeek is OpenAI-compatible otherwise: reasoning output arrives on
 * `delta.reasoning_content` (already parsed by openai-completions) and the reasoning
 * replay rule for tool-call turns is handled by the shared convertMessages logic.
 *
 * Models registered with api "openai-completions-deepseek" automatically get
 * thinkingFormat "deepseek" injected — no manual compat config needed.
 */

import type { Context, Model, SimpleStreamOptions, StreamFunction } from "../types.js";
import type { AssistantMessageEventStream } from "../utils/event-stream.js";
import type { OpenAICompletionsOptions } from "./openai-completions.js";
import {
	createOpenAICompatibleAdapter,
	streamOpenAICompletions,
	streamSimpleOpenAICompletions,
} from "./openai-completions.js";

const DEEPSEEK_COMPAT = { thinkingFormat: "deepseek" as const };

function withDeepSeekCompat(model: Model<"openai-completions-deepseek">): Model<"openai-completions"> {
	return {
		...model,
		api: "openai-completions" as const,
		compat: Object.assign({}, model.compat, DEEPSEEK_COMPAT),
	};
}

export const deepSeekAdapter = createOpenAICompatibleAdapter("openai-completions-deepseek", withDeepSeekCompat);

export const streamDeepSeek: StreamFunction<"openai-completions-deepseek", OpenAICompletionsOptions> = (
	model: Model<"openai-completions-deepseek">,
	context: Context,
	options?: OpenAICompletionsOptions,
): AssistantMessageEventStream => {
	return streamOpenAICompletions(withDeepSeekCompat(model), context, options);
};

export const streamSimpleDeepSeek: StreamFunction<"openai-completions-deepseek", SimpleStreamOptions> = (
	model: Model<"openai-completions-deepseek">,
	context: Context,
	options?: SimpleStreamOptions,
): AssistantMessageEventStream => {
	return streamSimpleOpenAICompletions(withDeepSeekCompat(model), context, options);
};
