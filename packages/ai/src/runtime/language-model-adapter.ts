import {
	AI_ERROR_CODES,
	AIError,
	type Api,
	type AssistantMessage,
	type AssistantMessageEvent,
	type Context,
} from "../protocol/index.js";
import type { Model, StreamOptions } from "../types.js";
import { type AssistantMessageEventStream, EventStream } from "../utils/event-stream.js";
import type { ApiProvider } from "./adapter-registry.js";
import { classifyLegacyAssistantError, normalizeLegacyProviderError } from "./legacy-error-classifier.js";

export type LanguageModelStreamEvent = Exclude<AssistantMessageEvent, { type: "error" }>;

export class LanguageModelStream extends EventStream<LanguageModelStreamEvent, AssistantMessage> {
	constructor() {
		super(
			(event) => event.type === "done",
			(event) => {
				if (event.type === "done") return event.message;
				throw new AIError(AI_ERROR_CODES.STREAM_PROTOCOL_FAILED, "Expected a done event", {
					metadata: { eventType: event.type },
				});
			},
		);
	}
}

export interface ModelCallRequest<TApi extends Api = Api, TOptions extends StreamOptions = StreamOptions> {
	readonly model: Model<TApi>;
	readonly context: Context;
	readonly options?: TOptions;
}

export interface ModelStreamResponse {
	readonly events: AsyncIterable<LanguageModelStreamEvent>;
	readonly result: Promise<AssistantMessage>;
}

export interface LanguageModelAdapter<TApi extends Api = Api, TOptions extends StreamOptions = StreamOptions> {
	readonly api: TApi;
	stream(request: ModelCallRequest<TApi, TOptions>): Promise<ModelStreamResponse>;
}

export interface RegisteredLanguageModelAdapter {
	readonly api: Api;
	stream(request: ModelCallRequest): Promise<ModelStreamResponse>;
}

export function adaptApiProvider<TApi extends Api, TOptions extends StreamOptions>(
	provider: ApiProvider<TApi, TOptions>,
): LanguageModelAdapter<TApi, TOptions> {
	return {
		api: provider.api,
		async stream(request) {
			const { model, context, options } = request;
			let source: ReturnType<typeof provider.stream>;
			try {
				source = provider.stream(model, context, options);
			} catch (error) {
				throw normalizeLegacyProviderError(error, model);
			}
			return adaptLegacyAssistantMessageStream(source, model);
		},
	};
}

export function adaptLegacyAssistantMessageStream<TApi extends Api>(
	source: AssistantMessageEventStream,
	model: Model<TApi>,
): ModelStreamResponse {
	const target = new LanguageModelStream();
	void forwardLegacyStream(source, target, model);
	return { events: target, result: target.result() };
}

async function forwardLegacyStream<TApi extends Api>(
	source: AssistantMessageEventStream,
	target: LanguageModelStream,
	model: Model<TApi>,
): Promise<void> {
	try {
		for await (const event of source) {
			if (event.type === "error") {
				target.fail(classifyLegacyAssistantError(event.error, model));
				return;
			}
			target.push(event);
		}
	} catch (error) {
		target.fail(normalizeLegacyProviderError(error, model));
	}
}
