import { getEnvApiKey } from "../../env-api-keys.js";
import { AIAbortedError, AIStreamProtocolError, type AssistantMessage } from "../../protocol/index.js";
import {
	EmptyProviderStreamError,
	isSdkEmptyStreamError,
	normalizeProviderError,
	validateWirePayload,
} from "../../provider-kit/index.js";
import {
	type LanguageModelAdapter,
	LanguageModelStream,
	type ModelCallRequest,
	type ModelStreamResponse,
} from "../../runtime/language-model-adapter.js";
import type { Model } from "../../types.js";
import { buildCopilotDynamicHeaders, hasCopilotVisionInput } from "../github-copilot-headers.js";
import { createAnthropicClient } from "./client.js";
import { AnthropicEventReducer } from "./events.js";
import type { AnthropicOptions } from "./options.js";
import { buildAnthropicParams } from "./request.js";
import { anthropicStreamEventSchema } from "./response-schema.js";

export const anthropicAdapter: LanguageModelAdapter<"anthropic-messages", AnthropicOptions> = {
	api: "anthropic-messages",
	async stream(request) {
		return createAnthropicModelStream(request);
	},
};

function createAnthropicModelStream(
	request: ModelCallRequest<"anthropic-messages", AnthropicOptions>,
): ModelStreamResponse {
	const stream = new LanguageModelStream();
	void produceAnthropicStream(request, stream);
	return { events: stream, result: stream.result() };
}

async function produceAnthropicStream(
	request: ModelCallRequest<"anthropic-messages", AnthropicOptions>,
	stream: LanguageModelStream,
): Promise<void> {
	const { model, context, options } = request;
	const output = createAssistantMessage(model);
	let receivedProviderEvent = false;
	try {
		if (options?.signal?.aborted) throw new AIAbortedError();
		const apiKey = options?.apiKey ?? getEnvApiKey(model.provider) ?? "";
		const dynamicHeaders =
			model.provider === "github-copilot"
				? buildCopilotDynamicHeaders({
						messages: context.messages,
						hasImages: hasCopilotVisionInput(context.messages),
					})
				: undefined;
		const { client, isOAuthToken } = createAnthropicClient(
			model,
			apiKey,
			options?.interleavedThinking ?? true,
			options?.headers,
			dynamicHeaders,
			options?.fetch,
		);
		const params = buildAnthropicParams(model, context, isOAuthToken, options);
		options?.onPayload?.(params);
		const response = client.messages.stream({ ...params, stream: true }, { signal: options?.signal });
		const reducer = new AnthropicEventReducer(output, model, context, isOAuthToken, stream);
		stream.push({ type: "start", partial: output });

		for await (const event of response) {
			receivedProviderEvent = true;
			validateWirePayload(anthropicStreamEventSchema, event, {
				provider: model.provider,
				payloadType: "Anthropic stream event",
			});
			reducer.consume(event);
		}
		if (!receivedProviderEvent) throw new EmptyProviderStreamError();
		reducer.finish();
		if (options?.signal?.aborted) throw new AIAbortedError();
		if (output.stopReason === "error" || output.stopReason === "aborted") {
			throw new Error("Anthropic returned a failed response status");
		}
		stream.push({ type: "done", reason: output.stopReason, message: output });
	} catch (error) {
		const normalizedError = normalizeAnthropicSdkStreamError(error, receivedProviderEvent, model);
		stream.fail(
			options?.signal?.aborted
				? new AIAbortedError(undefined, { provider: model.provider, modelId: model.id, cause: normalizedError })
				: normalizeProviderError(normalizedError, model),
		);
	}
}

function normalizeAnthropicSdkStreamError(
	error: unknown,
	receivedProviderEvent: boolean,
	model: Model<"anthropic-messages">,
): unknown {
	if (!receivedProviderEvent && isSdkEmptyStreamError(error)) return new EmptyProviderStreamError(error);
	if (error instanceof Error && /unexpected event order|expected .* event/i.test(error.message)) {
		return new AIStreamProtocolError(error.message, {
			provider: model.provider,
			modelId: model.id,
			cause: error,
		});
	}
	return error;
}

function createAssistantMessage(model: Model<"anthropic-messages">): AssistantMessage {
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
