/**
 * NVIDIA OpenAI Responses provider.
 *
 * Inherits from openai-completions with NVIDIA-specific thinking format:
 *   chat_template_kwargs: { enable_thinking: boolean }
 *
 * Models registered with api "nvidia-openai-responses" automatically get
 * thinkingFormat "nvidia" injected — no manual compat config needed.
 */

import type { Context, Model, SimpleStreamOptions, StreamFunction } from "../types.js";
import type { AssistantMessageEventStream } from "../utils/event-stream.js";
import type { OpenAICompletionsOptions } from "./openai-completions.js";
import {
	createOpenAICompatibleAdapter,
	streamOpenAICompletions,
	streamSimpleOpenAICompletions,
} from "./openai-completions.js";

const NVIDIA_COMPAT = { thinkingFormat: "nvidia" as const };

function withNvidiaCompat(model: Model<"nvidia-openai-responses">): Model<"openai-completions"> {
	return {
		...model,
		api: "openai-completions" as const,
		compat: Object.assign({}, model.compat, NVIDIA_COMPAT),
	};
}

export const nvidiaAdapter = createOpenAICompatibleAdapter("nvidia-openai-responses", withNvidiaCompat);

export const streamNvidia: StreamFunction<"nvidia-openai-responses", OpenAICompletionsOptions> = (
	model: Model<"nvidia-openai-responses">,
	context: Context,
	options?: OpenAICompletionsOptions,
): AssistantMessageEventStream => {
	return streamOpenAICompletions(withNvidiaCompat(model), context, options);
};

export const streamSimpleNvidia: StreamFunction<"nvidia-openai-responses", SimpleStreamOptions> = (
	model: Model<"nvidia-openai-responses">,
	context: Context,
	options?: SimpleStreamOptions,
): AssistantMessageEventStream => {
	return streamSimpleOpenAICompletions(withNvidiaCompat(model), context, options);
};
