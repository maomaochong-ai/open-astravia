import { AI_ERROR_CODES, type AIError, type Api, type AssistantMessage, type Context } from "../protocol/index.js";
import type { LanguageModelAdapter } from "../runtime/language-model-adapter.js";
import type { Model, StreamOptions } from "../types.js";
import { AssistantMessageEventStream } from "../utils/event-stream.js";

export function projectLanguageModelAdapter<TApi extends Api, TOptions extends StreamOptions>(
	adapter: LanguageModelAdapter<TApi, TOptions>,
	model: Model<TApi>,
	context: Context,
	options?: TOptions,
): AssistantMessageEventStream {
	const target = new AssistantMessageEventStream();
	void forwardAdapterResponse(adapter, model, context, options, target);
	return target;
}

async function forwardAdapterResponse<TApi extends Api, TOptions extends StreamOptions>(
	adapter: LanguageModelAdapter<TApi, TOptions>,
	model: Model<TApi>,
	context: Context,
	options: TOptions | undefined,
	target: AssistantMessageEventStream,
): Promise<void> {
	try {
		const response = await adapter.stream({ model, context, options });
		for await (const event of response.events) target.push(event);
	} catch (error) {
		const reason = isAIError(error) && error.code === AI_ERROR_CODES.ABORTED ? "aborted" : "error";
		target.push({ type: "error", reason, error: compatibilityErrorMessage(model, error, reason) });
	}
}

function compatibilityErrorMessage<TApi extends Api>(
	model: Model<TApi>,
	error: unknown,
	reason: "error" | "aborted",
): AssistantMessage {
	return {
		role: "assistant",
		content: [],
		api: model.api,
		provider: model.provider,
		model: model.id,
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: reason,
		errorMessage: error instanceof Error ? error.message : String(error),
		timestamp: Date.now(),
	};
}

function isAIError(error: unknown): error is AIError {
	return error instanceof Error && "code" in error && typeof error.code === "string";
}
