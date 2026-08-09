import { getEnvApiKey } from "../../env-api-keys.js";
import { AIAbortedError, AIStreamProtocolError, type Api, type AssistantMessage } from "../../protocol/index.js";
import { normalizeProviderError } from "../../provider-kit/index.js";
import {
	type LanguageModelAdapter,
	LanguageModelStream,
	type ModelCallRequest,
	type ModelStreamResponse,
} from "../../runtime/language-model-adapter.js";
import type { Model, StreamOptions } from "../../types.js";
import type { ResponsesEventSink } from "./events.js";
import { processResponsesStream } from "./events.js";
import type { OpenAIResponsesOptions } from "./options.js";
import { applyServiceTierPricing, buildOpenAIResponsesParams, createOpenAIResponsesClient } from "./request.js";

export interface ResponsesAdapterExecutionContext<
	TApi extends Api = Api,
	TOptions extends StreamOptions = StreamOptions,
> {
	readonly request: ModelCallRequest<TApi, TOptions>;
	readonly output: AssistantMessage;
	readonly stream: ResponsesEventSink;
	readonly signal: AbortSignal | undefined;
	start(): void;
}

export type ResponsesAdapterExecutor<TApi extends Api, TOptions extends StreamOptions> = (
	context: ResponsesAdapterExecutionContext<TApi, TOptions>,
) => Promise<void>;

export const openAIResponsesAdapter = createResponsesAdapter<"openai-responses", OpenAIResponsesOptions>(
	"openai-responses",
	async ({ request, output, stream, signal, start }) => {
		const { model, context, options } = request;
		const apiKey = options?.apiKey || getEnvApiKey(model.provider) || "";
		if (!apiKey) {
			throw new Error(
				"OpenAI API key is required. Set OPENAI_API_KEY environment variable or pass it as an argument.",
			);
		}
		const client = createOpenAIResponsesClient(model, context, apiKey, options);
		const params = buildOpenAIResponsesParams(model, context, options);
		options?.onPayload?.(params);
		const providerStream = await client.responses.create(params, signal ? { signal } : undefined);
		start();
		await processResponsesStream(providerStream, output, stream, model, {
			serviceTier: options?.serviceTier,
			applyServiceTierPricing,
		});
	},
);

export function createResponsesAdapter<TApi extends Api, TOptions extends StreamOptions>(
	api: TApi,
	execute: ResponsesAdapterExecutor<TApi, TOptions>,
): LanguageModelAdapter<TApi, TOptions> {
	return {
		api,
		async stream(request) {
			return createResponsesModelStream(request, execute);
		},
	};
}

function createResponsesModelStream<TApi extends Api, TOptions extends StreamOptions>(
	request: ModelCallRequest<TApi, TOptions>,
	execute: ResponsesAdapterExecutor<TApi, TOptions>,
): ModelStreamResponse {
	const stream = new LanguageModelStream();
	void produceResponses(request, execute, stream);
	return { events: stream, result: stream.result() };
}

async function produceResponses<TApi extends Api, TOptions extends StreamOptions>(
	request: ModelCallRequest<TApi, TOptions>,
	execute: ResponsesAdapterExecutor<TApi, TOptions>,
	stream: LanguageModelStream,
): Promise<void> {
	const { model, options } = request;
	const output = createAssistantMessage(model);
	const signal = options?.signal;
	let started = false;
	try {
		if (signal?.aborted) throw new AIAbortedError();
		await execute({
			request,
			output,
			stream,
			signal,
			start() {
				if (started) return;
				started = true;
				stream.push({ type: "start", partial: output });
			},
		});
		if (signal?.aborted) throw new AIAbortedError();
		if (!started) throw new AIStreamProtocolError("Provider stream started without publishing its lifecycle start");
		if (output.stopReason === "error" || output.stopReason === "aborted") {
			throw new Error("Provider returned a failed response status");
		}
		stream.push({ type: "done", reason: output.stopReason, message: output });
	} catch (error) {
		stream.fail(
			signal?.aborted
				? new AIAbortedError(undefined, { provider: model.provider, modelId: model.id, cause: error })
				: normalizeProviderError(error, model),
		);
	}
}

function createAssistantMessage<TApi extends Api>(model: Model<TApi>): AssistantMessage {
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
