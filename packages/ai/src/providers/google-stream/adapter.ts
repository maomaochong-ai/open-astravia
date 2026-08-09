import type { GenerateContentParameters } from "@google/genai";
import { AIAbortedError, type Api, type AssistantMessage } from "../../protocol/index.js";
import { EmptyProviderStreamError, normalizeProviderError, validateWirePayload } from "../../provider-kit/index.js";
import {
	type LanguageModelAdapter,
	LanguageModelStream,
	type ModelCallRequest,
} from "../../runtime/language-model-adapter.js";
import type { Model, StreamOptions } from "../../types.js";
import { GeminiEventReducer } from "./events.js";
import { geminiResponseChunkSchema } from "./response-schema.js";

export type GoogleGenerateContentSender<TApi extends Api, TOptions extends StreamOptions> = (
	params: GenerateContentParameters,
	request: ModelCallRequest<TApi, TOptions>,
) => Promise<AsyncIterable<unknown>>;

export interface GoogleSdkAdapterConfig<TApi extends Api, TOptions extends StreamOptions> {
	readonly api: TApi;
	readonly buildParams: (request: ModelCallRequest<TApi, TOptions>) => GenerateContentParameters;
	readonly send: GoogleGenerateContentSender<TApi, TOptions>;
}

export function createGoogleSdkAdapter<TApi extends Api, TOptions extends StreamOptions>(
	config: GoogleSdkAdapterConfig<TApi, TOptions>,
): LanguageModelAdapter<TApi, TOptions> {
	return {
		api: config.api,
		async stream(request) {
			const stream = new LanguageModelStream();
			void produceGoogleSdkStream(config, request, stream);
			return { events: stream, result: stream.result() };
		},
	};
}

async function produceGoogleSdkStream<TApi extends Api, TOptions extends StreamOptions>(
	config: GoogleSdkAdapterConfig<TApi, TOptions>,
	request: ModelCallRequest<TApi, TOptions>,
	stream: LanguageModelStream,
): Promise<void> {
	const { model, options } = request;
	const output = createGoogleAssistantMessage(model);
	try {
		if (options?.signal?.aborted) throw new AIAbortedError();
		const params = config.buildParams(request);
		options?.onPayload?.(params);
		const source = await config.send(params, request);
		const reducer = new GeminiEventReducer(output, model, stream);
		let receivedProviderEvent = false;
		stream.push({ type: "start", partial: output });
		for await (const rawChunk of source) {
			receivedProviderEvent = true;
			const chunk = validateWirePayload(geminiResponseChunkSchema, rawChunk, {
				provider: model.provider,
				payloadType: "Gemini stream chunk",
			});
			reducer.consume(chunk);
		}
		if (!receivedProviderEvent) throw new EmptyProviderStreamError();
		reducer.finish();
		if (options?.signal?.aborted) throw new AIAbortedError();
		if (output.stopReason === "error" || output.stopReason === "aborted") {
			throw new Error("Gemini returned a failed response status");
		}
		stream.push({ type: "done", reason: output.stopReason, message: output });
	} catch (error) {
		stream.fail(
			options?.signal?.aborted
				? new AIAbortedError(undefined, { provider: model.provider, modelId: model.id, cause: error })
				: normalizeProviderError(error, model),
		);
	}
}

export function createGoogleAssistantMessage<TApi extends Api>(model: Model<TApi>): AssistantMessage {
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
		stopReason: "stop",
		timestamp: Date.now(),
	};
}
