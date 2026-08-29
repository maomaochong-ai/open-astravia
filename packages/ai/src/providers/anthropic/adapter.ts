import { getEnvApiKey } from "../../env-api-keys.js";
import {
	AIAbortedError,
	AIStreamProtocolError,
	type AssistantMessage,
	createAssistantMessage as createProtocolAssistantMessage,
} from "../../protocol/index.js";
import {
	EmptyProviderStreamError,
	isSdkEmptyStreamError,
	normalizeProviderError,
	requireProviderCredential,
	validateWirePayload,
} from "../../provider-kit/index.js";
import {
	failLanguageModelStream,
	type LanguageModelAdapter,
	LanguageModelStream,
	type ModelCallRequest,
	type ModelStreamResponse,
} from "../../runtime/language-model-adapter.js";
import { createModelCallMetadata, type ModelWarning } from "../../runtime/model-call-result.js";
import type { Model, SimpleStreamOptions } from "../../types.js";
import { buildCopilotDynamicHeaders, hasCopilotVisionInput } from "../github-copilot-headers.js";
import { adjustMaxTokensForThinking, buildBaseOptions } from "../simple-options.js";
import { createAnthropicClient } from "./client.js";
import { AnthropicEventReducer } from "./events.js";
import type { AnthropicOptions } from "./options.js";
import { mapThinkingLevelToEffort, supportsAdaptiveThinking } from "./options.js";
import { resolveAnthropicOutputTokenLimit } from "./output-token-limit.js";
import { buildAnthropicParams } from "./request.js";
import { anthropicStreamEventSchema } from "./response-schema.js";

export const anthropicAdapter: LanguageModelAdapter<"anthropic-messages", AnthropicOptions> = {
	api: "anthropic-messages",
	capabilities: {
		streaming: true,
		tools: true,
		structuredOutput: false,
		reasoning: true,
		parallelToolCalls: true,
	},
	async streamSimple(request: ModelCallRequest<"anthropic-messages", SimpleStreamOptions>) {
		const { model, context, options } = request;
		const apiKey = requireProviderCredential(model, options?.apiKey || getEnvApiKey(model.provider));
		const outputTokenLimit = resolveAnthropicOutputTokenLimit(model, options?.maxTokens);
		const base = { ...buildBaseOptions(model, options, apiKey), maxTokens: outputTokenLimit.maxTokens };
		if (!options?.reasoning)
			return createAnthropicModelStream(
				{ model, context, options: { ...base, thinkingEnabled: false } },
				outputTokenLimit.warnings,
			);
		if (supportsAdaptiveThinking(model.id)) {
			return createAnthropicModelStream(
				{
					model,
					context,
					options: {
						...base,
						thinkingEnabled: true,
						effort: mapThinkingLevelToEffort(options.reasoning, model.id),
					},
				},
				outputTokenLimit.warnings,
			);
		}
		const adjusted = adjustMaxTokensForThinking(
			base.maxTokens,
			model.maxTokens,
			options.reasoning,
			options.thinkingBudgets,
		);
		return createAnthropicModelStream(
			{
				model,
				context,
				options: {
					...base,
					maxTokens: adjusted.maxTokens,
					thinkingEnabled: true,
					thinkingBudgetTokens: adjusted.thinkingBudget,
				},
			},
			outputTokenLimit.warnings,
		);
	},
	async stream(request) {
		const outputTokenLimit = resolveAnthropicOutputTokenLimit(request.model, request.options?.maxTokens);
		return createAnthropicModelStream(
			{
				...request,
				options: { ...request.options, maxTokens: outputTokenLimit.maxTokens },
			},
			outputTokenLimit.warnings,
		);
	},
};

function createAnthropicModelStream(
	request: ModelCallRequest<"anthropic-messages", AnthropicOptions>,
	warnings: readonly ModelWarning[] = [],
): ModelStreamResponse {
	const stream = new LanguageModelStream();
	void produceAnthropicStream(request, stream);
	const result = stream.result();
	return {
		events: stream,
		result,
		metadata: result.then(
			(message) => createModelCallMetadata({ unified: message.stopReason }, message.usage, { warnings }),
			() => ({}),
		),
	};
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
		const apiKey = requireProviderCredential(model, options?.apiKey ?? getEnvApiKey(model.provider));
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
		failLanguageModelStream(
			stream,
			model,
			options?.signal?.aborted
				? new AIAbortedError(undefined, { provider: model.provider, modelId: model.id, cause: normalizedError })
				: normalizeProviderError(normalizedError, model),
			options?.signal?.aborted ? "aborted" : "error",
			{
				...output,
				stopReason: options?.signal?.aborted ? "aborted" : "error",
				errorMessage: normalizedError instanceof Error ? normalizedError.message : String(normalizedError),
			},
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
	return createProtocolAssistantMessage({ api: model.api, provider: model.provider, model: model.id });
}
