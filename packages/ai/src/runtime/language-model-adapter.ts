import {
	AI_ERROR_CODES,
	AIError,
	type Api,
	type AssistantMessage,
	type AssistantMessageEvent,
	type Context,
	createAIErrorFromDetails,
	createAssistantMessage,
	getAIErrorDetails,
	isAIError,
} from "../protocol/index.js";
import type { ModelCapabilities } from "../protocol/model-capabilities.js";
import type { Model, SimpleStreamOptions, StreamOptions } from "../types.js";
import { type AssistantMessageEventStream, EventStream } from "../utils/event-stream.js";
import type { ApiProvider } from "./adapter-registry.js";
import { normalizeAssistantMessageError, normalizeLegacyProviderError } from "./legacy-error-classifier.js";
import type { ModelCallMetadata, ModelCallResult } from "./model-call-result.js";
import { createModelCallMetadataFromMessage } from "./model-call-result.js";

/** Provider stream events include the terminal error event so hosts can persist it. */
export type LanguageModelStreamEvent = AssistantMessageEvent;

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

export function failLanguageModelStream<TApi extends Api>(
	stream: LanguageModelStream,
	model: Model<TApi>,
	error: unknown,
	reason: "error" | "aborted" = isAIError(error) && error.code === AI_ERROR_CODES.ABORTED ? "aborted" : "error",
	message?: AssistantMessage,
): void {
	const failure = isAIError(error) ? getAIErrorDetails(error) : undefined;
	const terminalMessage = message
		? failure === undefined
			? message
			: { ...message, failure }
		: createCompatibilityErrorMessage(model, error, reason);
	stream.push({
		type: "error",
		reason,
		error: terminalMessage,
		...(isAIError(error) ? { failure: getAIErrorDetails(error) } : {}),
	});
	stream.fail(error);
}

export interface ModelCallRequest<TApi extends Api = Api, TOptions extends StreamOptions = StreamOptions> {
	readonly model: Model<TApi>;
	readonly context: Context;
	readonly options?: TOptions;
}

export interface ModelStreamResponse {
	readonly events: AsyncIterable<LanguageModelStreamEvent>;
	readonly result: Promise<AssistantMessage>;
	/** Metadata is resolved with the terminal result and remains optional for legacy adapters. */
	readonly metadata?: Promise<ModelCallMetadata>;
}

export interface ModelGenerateResponse {
	readonly result: Promise<ModelCallResult>;
}

/**
 * Applies the shared Provider failure contract to an Adapter response.
 *
 * Adapters are allowed to focus on wire decoding. The registry owns the
 * invocation boundary so extension adapters cannot accidentally leak raw SDK
 * errors through `events`, `result`, or `metadata`.
 */
export function normalizeLanguageModelResponse<TApi extends Api>(
	source: ModelStreamResponse,
	model: Model<TApi>,
): ModelStreamResponse {
	const target = new LanguageModelStream();
	// A provider may reject result after publishing an error event. Keep that
	// rejection observed while the event stream remains the user-facing source.
	void source.result.catch(() => undefined);
	void forwardNormalizedResponse(source, model, target);
	const result = target.result();
	const metadata = source.metadata
		? source.metadata.catch((error) => {
				throw normalizeLegacyProviderError(error, model);
			})
		: result.then(createModelCallMetadataFromMessage, () => ({}));
	void metadata.catch(() => undefined);
	return { events: target, result, metadata };
}

/** Normalizes a native non-streaming response at the same Adapter boundary. */
export function normalizeLanguageModelGenerateResponse<TApi extends Api>(
	source: ModelGenerateResponse,
	model: Model<TApi>,
): ModelGenerateResponse {
	return {
		result: source.result.catch((error) => {
			throw normalizeLegacyProviderError(error, model);
		}),
	};
}

export interface LanguageModelAdapter<TApi extends Api = Api, TOptions extends StreamOptions = StreamOptions> {
	readonly api: TApi;
	readonly capabilities?: Partial<ModelCapabilities>;
	stream(request: ModelCallRequest<TApi, TOptions>): Promise<ModelStreamResponse>;
	streamSimple?(request: ModelCallRequest<TApi, SimpleStreamOptions>): Promise<ModelStreamResponse>;
	/** Optional non-streaming entry point for providers that expose a native generate API. */
	generate?(request: ModelCallRequest<TApi, TOptions>): Promise<ModelGenerateResponse>;
}

export interface RegisteredLanguageModelAdapter {
	readonly api: Api;
	readonly capabilities?: Partial<ModelCapabilities>;
	stream(request: ModelCallRequest): Promise<ModelStreamResponse>;
	streamSimple?(request: ModelCallRequest): Promise<ModelStreamResponse>;
	generate?(request: ModelCallRequest): Promise<ModelGenerateResponse>;
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

async function forwardNormalizedResponse<TApi extends Api>(
	source: ModelStreamResponse,
	model: Model<TApi>,
	target: LanguageModelStream,
): Promise<void> {
	try {
		for await (const event of source.events) {
			target.push(event);
			if (event.type === "done") return;
			if (event.type === "error") {
				target.fail(
					event.failure
						? createAIErrorFromDetails(event.failure)
						: normalizeLegacyProviderError(new Error(event.error.errorMessage || "Model call failed"), model),
				);
				return;
			}
		}

		// The event iterable is the lifecycle source of truth. A malformed source
		// must fail immediately; its result is observed separately so a late
		// rejection cannot become an unhandled Promise.
		failLanguageModelStream(
			target,
			model,
			new AIError(AI_ERROR_CODES.STREAM_PROTOCOL_FAILED, "Model stream ended without a terminal event", {
				provider: model.provider,
				modelId: model.id,
			}),
		);
	} catch (error) {
		failLanguageModelStream(target, model, normalizeLegacyProviderError(error, model));
	}
}

export function adaptLegacyAssistantMessageStream<TApi extends Api>(
	source: AssistantMessageEventStream,
	model: Model<TApi>,
): ModelStreamResponse {
	const target = new LanguageModelStream();
	void forwardLegacyStream(source, target, model);
	const result = target.result();
	return { events: target, result, metadata: result.then(createModelCallMetadataFromMessage, () => ({})) };
}

async function forwardLegacyStream<TApi extends Api>(
	source: AssistantMessageEventStream,
	target: LanguageModelStream,
	model: Model<TApi>,
): Promise<void> {
	try {
		for await (const event of source) {
			if (event.type === "error") {
				failLanguageModelStream(
					target,
					model,
					event.failure
						? createAIErrorFromDetails(event.failure)
						: normalizeAssistantMessageError(event.error, model),
					event.reason,
					event.error,
				);
				return;
			}
			target.push(event);
		}
	} catch (error) {
		failLanguageModelStream(target, model, normalizeLegacyProviderError(error, model));
	}
}

export function createCompatibilityErrorMessage<TApi extends Api>(
	model: Model<TApi>,
	error: unknown,
	reason: "error" | "aborted",
): AssistantMessage {
	return createAssistantMessage(
		{ api: model.api, provider: model.provider, model: model.id },
		{
			stopReason: reason,
			errorMessage: error instanceof Error ? error.message : String(error),
			...(isAIError(error) ? { failure: getAIErrorDetails(error) } : {}),
		},
	);
}
