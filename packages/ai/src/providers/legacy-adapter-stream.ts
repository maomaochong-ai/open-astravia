import { AI_ERROR_CODES, type Api, type Context, getAIErrorDetails, isAIError } from "../protocol/index.js";
import { createCompatibilityErrorMessage, type LanguageModelAdapter } from "../runtime/language-model-adapter.js";
import type { Model, SimpleStreamOptions, StreamOptions } from "../types.js";
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

export function projectLanguageModelSimpleAdapter<TApi extends Api>(
	adapter: LanguageModelAdapter<TApi>,
	model: Model<TApi>,
	context: Context,
	options?: SimpleStreamOptions,
): AssistantMessageEventStream {
	const target = new AssistantMessageEventStream();
	void forwardSimpleAdapterResponse(adapter, model, context, options, target);
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
		target.push({
			type: "error",
			reason,
			error: createCompatibilityErrorMessage(model, error, reason),
			...(isAIError(error) ? { failure: getAIErrorDetails(error) } : {}),
		});
	}
}

async function forwardSimpleAdapterResponse<TApi extends Api>(
	adapter: LanguageModelAdapter<TApi>,
	model: Model<TApi>,
	context: Context,
	options: SimpleStreamOptions | undefined,
	target: AssistantMessageEventStream,
): Promise<void> {
	try {
		if (!adapter.streamSimple) throw new Error(`Adapter does not support simple streaming: ${adapter.api}`);
		const response = await adapter.streamSimple({ model, context, options });
		for await (const event of response.events) target.push(event);
	} catch (error) {
		const reason = isAIError(error) && error.code === AI_ERROR_CODES.ABORTED ? "aborted" : "error";
		target.push({
			type: "error",
			reason,
			error: createCompatibilityErrorMessage(model, error, reason),
			...(isAIError(error) ? { failure: getAIErrorDetails(error) } : {}),
		});
	}
}
