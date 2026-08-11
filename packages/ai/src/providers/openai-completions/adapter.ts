import type { ChatCompletionChunk } from "openai/resources/chat/completions.js";
import { getEnvApiKey } from "../../env-api-keys.js";
import { calculateCost } from "../../models.js";
import { AIAbortedError, type Api } from "../../protocol/index.js";
import { EmptyProviderStreamError, normalizeProviderError, validateWirePayload } from "../../provider-kit/index.js";
import {
	type LanguageModelAdapter,
	LanguageModelStream,
	type ModelCallRequest,
	type ModelStreamResponse,
} from "../../runtime/language-model-adapter.js";
import type { AssistantMessage, Model, StopReason, TextContent, ThinkingContent, ToolCall } from "../../types.js";
import { parseStreamingJson } from "../../utils/json-parse.js";
import { createLinkedAbortSignal } from "../../utils/linked-abort-signal.js";
import { type ThinkingTagSegment, ThinkingTagSplitter } from "../thinking-tag-splitter.js";
import type { OpenAICompletionsOptions } from "./options.js";
import { buildOpenAICompletionsParams, createOpenAICompletionsClient } from "./request.js";
import { openAIChatCompletionChunkSchema } from "./response-schema.js";

type PartialToolCall = ToolCall & { partialArgs?: string };
type CompatibleDelta = ChatCompletionChunk.Choice.Delta & {
	reasoning_content?: string;
	reasoning?: string;
	reasoning_text?: string;
	reasoning_details?: Array<{ type?: string; id?: string; data?: string }>;
};

export type OpenAICompatibleModelMapper<TApi extends Api> = (model: Model<TApi>) => Model<"openai-completions">;

export const openAICompletionsAdapter = createOpenAICompatibleAdapter("openai-completions", (model) => model);

export function createOpenAICompatibleAdapter<TApi extends Api>(
	api: TApi,
	mapModel: OpenAICompatibleModelMapper<TApi>,
): LanguageModelAdapter<TApi, OpenAICompletionsOptions> {
	return {
		api,
		async stream(request) {
			return createOpenAICompletionsResponse({
				model: mapModel(request.model),
				context: request.context,
				options: request.options,
			});
		},
	};
}

function createOpenAICompletionsResponse(
	request: ModelCallRequest<"openai-completions", OpenAICompletionsOptions>,
): ModelStreamResponse {
	const stream = new LanguageModelStream();
	void produceOpenAICompletions(request, stream);
	return { events: stream, result: stream.result() };
}

async function produceOpenAICompletions(
	request: ModelCallRequest<"openai-completions", OpenAICompletionsOptions>,
	stream: LanguageModelStream,
): Promise<void> {
	const { model, context, options } = request;
	const output = createAssistantMessage(model);
	const requestAbort = createLinkedAbortSignal(options?.signal);
	try {
		const apiKey = options?.apiKey || getEnvApiKey(model.provider) || "";
		const client = createOpenAICompletionsClient(model, context, apiKey, options?.headers, options?.fetch);
		const params = buildOpenAICompletionsParams(model, context, options);
		options?.onPayload?.(params);
		const response = await client.chat.completions.create(params, { signal: requestAbort.signal });
		stream.push({ type: "start", partial: output });

		let currentBlock: TextContent | ThinkingContent | PartialToolCall | null = null;
		const blocks = output.content;
		const blockIndex = () => blocks.length - 1;
		const toolCallByIndex = new Map<number, PartialToolCall>();
		const finishCurrentBlock = (block?: typeof currentBlock) => {
			if (!block) return;
			const contentIndex = blocks.indexOf(block as (typeof blocks)[number]);
			if (block.type === "text") {
				stream.push({ type: "text_end", contentIndex, content: block.text, partial: output });
			} else if (block.type === "thinking") {
				stream.push({ type: "thinking_end", contentIndex, content: block.thinking, partial: output });
			} else {
				block.arguments = parseStreamingJson(block.partialArgs);
				delete block.partialArgs;
				stream.push({ type: "toolcall_end", contentIndex, toolCall: block, partial: output });
			}
		};

		const contentSplitter = new ThinkingTagSplitter();
		const emitContentSegment = (segment: ThinkingTagSegment) => {
			if (segment.kind === "thinking") {
				if (!currentBlock || currentBlock.type !== "thinking") {
					finishCurrentBlock(currentBlock);
					currentBlock = { type: "thinking", thinking: "" };
					blocks.push(currentBlock);
					stream.push({ type: "thinking_start", contentIndex: blockIndex(), partial: output });
				}
				currentBlock.thinking += segment.text;
				stream.push({ type: "thinking_delta", contentIndex: blockIndex(), delta: segment.text, partial: output });
				return;
			}

			if (!currentBlock || currentBlock.type !== "text") {
				finishCurrentBlock(currentBlock);
				currentBlock = { type: "text", text: "" };
				blocks.push(currentBlock);
				stream.push({ type: "text_start", contentIndex: blockIndex(), partial: output });
			}
			currentBlock.text += segment.text;
			stream.push({ type: "text_delta", contentIndex: blockIndex(), delta: segment.text, partial: output });
		};

		let receivedProviderChunk = false;
		for await (const chunk of response) {
			receivedProviderChunk = true;
			validateWirePayload(openAIChatCompletionChunkSchema, chunk, {
				provider: model.provider,
				payloadType: "OpenAI chat completion chunk",
			});
			if (chunk.usage) updateUsage(output, model, chunk);
			const choice = chunk.choices[0];
			if (!choice) continue;
			if (choice.finish_reason) output.stopReason = mapStopReason(choice.finish_reason);
			if (!choice.delta) continue;

			if (choice.delta.content) {
				for (const segment of contentSplitter.push(choice.delta.content)) emitContentSegment(segment);
			}

			const delta = choice.delta as CompatibleDelta;
			const reasoningField = findReasoningField(delta);
			if (reasoningField) {
				if (!currentBlock || currentBlock.type !== "thinking") {
					finishCurrentBlock(currentBlock);
					currentBlock = { type: "thinking", thinking: "", thinkingSignature: reasoningField };
					output.content.push(currentBlock);
					stream.push({ type: "thinking_start", contentIndex: blockIndex(), partial: output });
				}
				const reasoningDelta = delta[reasoningField];
				if (currentBlock.type === "thinking" && reasoningDelta) {
					currentBlock.thinking += reasoningDelta;
					stream.push({
						type: "thinking_delta",
						contentIndex: blockIndex(),
						delta: reasoningDelta,
						partial: output,
					});
				}
			}

			if (choice.delta.tool_calls) {
				for (const toolCall of choice.delta.tool_calls) {
					const protocolIndex = typeof toolCall.index === "number" ? toolCall.index : -1;
					let block = protocolIndex >= 0 ? toolCallByIndex.get(protocolIndex) : undefined;
					if (!block) {
						const hasPayload = !!(toolCall.id || toolCall.function?.name || toolCall.function?.arguments);
						if (!hasPayload) continue;
						finishCurrentBlock(currentBlock);
						block = {
							type: "toolCall",
							id: toolCall.id || "",
							name: toolCall.function?.name || "",
							arguments: {},
							partialArgs: "",
						};
						output.content.push(block);
						if (protocolIndex >= 0) toolCallByIndex.set(protocolIndex, block);
						currentBlock = block;
						stream.push({ type: "toolcall_start", contentIndex: blockIndex(), partial: output });
					} else if (currentBlock !== block) {
						finishCurrentBlock(currentBlock);
						currentBlock = block;
					}

					if (toolCall.id) block.id = toolCall.id;
					if (toolCall.function?.name) block.name = toolCall.function.name;
					let argumentsDelta = "";
					if (toolCall.function?.arguments) {
						argumentsDelta = toolCall.function.arguments;
						block.partialArgs = (block.partialArgs ?? "") + argumentsDelta;
						block.arguments = parseStreamingJson(block.partialArgs);
					}
					stream.push({
						type: "toolcall_delta",
						contentIndex: blocks.indexOf(block),
						delta: argumentsDelta,
						partial: output,
					});
				}
			}

			for (const detail of delta.reasoning_details ?? []) {
				if (detail.type === "reasoning.encrypted" && detail.id && detail.data) {
					const matchingToolCall = output.content.find(
						(block) => block.type === "toolCall" && block.id === detail.id,
					);
					if (matchingToolCall?.type === "toolCall") matchingToolCall.thoughtSignature = JSON.stringify(detail);
				}
			}
		}
		if (!receivedProviderChunk) throw new EmptyProviderStreamError();

		for (const segment of contentSplitter.flush()) emitContentSegment(segment);
		finishCurrentBlock(currentBlock);
		if (options?.signal?.aborted) throw new AIAbortedError();
		if (output.stopReason === "aborted" || output.stopReason === "error") {
			throw new Error("An unknown error occurred");
		}
		stream.push({ type: "done", reason: output.stopReason, message: output });
	} catch (error) {
		for (const block of output.content) Reflect.deleteProperty(block, "index");
		stream.fail(
			options?.signal?.aborted
				? new AIAbortedError(undefined, { cause: error })
				: normalizeProviderError(error, model),
		);
	} finally {
		requestAbort.dispose();
	}
}

function createAssistantMessage(model: Model<"openai-completions">): AssistantMessage {
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

function updateUsage(output: AssistantMessage, model: Model<"openai-completions">, chunk: ChatCompletionChunk): void {
	if (!chunk.usage) return;
	const cachedTokens = chunk.usage.prompt_tokens_details?.cached_tokens || 0;
	const reasoningTokens = chunk.usage.completion_tokens_details?.reasoning_tokens || 0;
	const input = (chunk.usage.prompt_tokens || 0) - cachedTokens;
	const outputTokens = (chunk.usage.completion_tokens || 0) + reasoningTokens;
	output.usage = {
		input,
		output: outputTokens,
		cacheRead: cachedTokens,
		cacheWrite: 0,
		totalTokens: input + outputTokens + cachedTokens,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
	calculateCost(model, output.usage);
}

function findReasoningField(delta: CompatibleDelta): "reasoning_content" | "reasoning" | "reasoning_text" | null {
	for (const field of ["reasoning_content", "reasoning", "reasoning_text"] as const) {
		if (delta[field]) return field;
	}
	return null;
}

function mapStopReason(reason: ChatCompletionChunk.Choice["finish_reason"]): StopReason {
	if (reason === null) return "stop";
	switch (reason) {
		case "stop":
			return "stop";
		case "length":
			return "length";
		case "function_call":
		case "tool_calls":
			return "toolUse";
		case "content_filter":
			return "error";
		default: {
			const exhaustive: never = reason;
			throw new Error(`Unhandled stop reason: ${exhaustive}`);
		}
	}
}
