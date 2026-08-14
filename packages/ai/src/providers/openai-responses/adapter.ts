import { getEnvApiKey } from "../../env-api-keys.js";
import {
	AIAbortedError,
	AIStreamProtocolError,
	type Api,
	type AssistantMessage,
	createAssistantMessage as createProtocolAssistantMessage,
} from "../../protocol/index.js";
import { normalizeProviderError, requireProviderCredential } from "../../provider-kit/index.js";
import {
	failLanguageModelStream,
	type LanguageModelAdapter,
	LanguageModelStream,
	type ModelCallRequest,
	type ModelStreamResponse,
} from "../../runtime/language-model-adapter.js";
import { createModelCallMetadataFromMessage } from "../../runtime/model-call-result.js";
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
		const apiKey = requireProviderCredential(
			model,
			options?.apiKey || getEnvApiKey(model.provider),
			"OpenAI API key is required. Set OPENAI_API_KEY environment variable or pass it as an argument.",
		);
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
		capabilities: {
			streaming: true,
			tools: true,
			structuredOutput: true,
			reasoning: true,
			parallelToolCalls: true,
		},
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
	const result = stream.result();
	return { events: stream, result, metadata: result.then(createModelCallMetadataFromMessage, () => ({})) };
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
		failLanguageModelStream(
			stream,
			model,
			signal?.aborted
				? new AIAbortedError(undefined, { provider: model.provider, modelId: model.id, cause: error })
				: normalizeProviderError(error, model),
			signal?.aborted ? "aborted" : "error",
			{
				...output,
				stopReason: signal?.aborted ? "aborted" : "error",
				errorMessage: error instanceof Error ? error.message : String(error),
			},
		);
	}
}

function createAssistantMessage<TApi extends Api>(model: Model<TApi>): AssistantMessage {
	return createProtocolAssistantMessage({ api: model.api, provider: model.provider, model: model.id });
}
