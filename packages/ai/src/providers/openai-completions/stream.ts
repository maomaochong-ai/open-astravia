import type { ChatCompletionChunk } from "openai/resources/chat/completions.js";
import { getEnvApiKey } from "../../env-api-keys.js";
import { calculateCost } from "../../models.js";
import type {
	AssistantMessage,
	Context,
	Model,
	SimpleStreamOptions,
	StopReason,
	StreamFunction,
	TextContent,
	ThinkingContent,
	ToolCall,
} from "../../types.js";
import { AssistantMessageEventStream } from "../../utils/event-stream.js";
import { parseStreamingJson } from "../../utils/json-parse.js";
import { createLinkedAbortSignal } from "../../utils/linked-abort-signal.js";
import { buildBaseOptions } from "../simple-options.js";
import { type ThinkingTagSegment, ThinkingTagSplitter } from "../thinking-tag-splitter.js";
import type { OpenAICompletionsOptions } from "./options.js";
import { buildOpenAICompletionsParams, createOpenAICompletionsClient } from "./request.js";

type PartialToolCall = ToolCall & { partialArgs?: string };
type CompatibleDelta = ChatCompletionChunk.Choice.Delta & {
	reasoning_content?: string;
	reasoning?: string;
	reasoning_text?: string;
	reasoning_details?: Array<{ type?: string; id?: string; data?: string }>;
};

export const streamOpenAICompletions: StreamFunction<"openai-completions", OpenAICompletionsOptions> = (
	model: Model<"openai-completions">,
	context: Context,
	options?: OpenAICompletionsOptions,
): AssistantMessageEventStream => {
	const stream = new AssistantMessageEventStream();

	(async () => {
		const output = createAssistantMessage(model);
		const requestAbort = createLinkedAbortSignal(options?.signal);
		try {
			const apiKey = options?.apiKey || getEnvApiKey(model.provider) || "";
			const client = createOpenAICompletionsClient(model, context, apiKey, options?.headers);
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
					stream.push({
						type: "thinking_delta",
						contentIndex: blockIndex(),
						delta: segment.text,
						partial: output,
					});
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

			for await (const chunk of response) {
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

			for (const segment of contentSplitter.flush()) emitContentSegment(segment);
			finishCurrentBlock(currentBlock);
			if (options?.signal?.aborted) throw new Error("Request was aborted");
			if (output.stopReason === "aborted" || output.stopReason === "error") {
				throw new Error("An unknown error occurred");
			}
			stream.push({ type: "done", reason: output.stopReason, message: output });
			stream.end();
		} catch (error) {
			for (const block of output.content) Reflect.deleteProperty(block, "index");
			output.stopReason = options?.signal?.aborted ? "aborted" : "error";
			output.errorMessage = error instanceof Error ? error.message : JSON.stringify(error);
			const rawMetadata = getRawErrorMetadata(error);
			if (rawMetadata) output.errorMessage += `\n${rawMetadata}`;
			stream.push({ type: "error", reason: output.stopReason, error: output });
			stream.end();
		} finally {
			requestAbort.dispose();
		}
	})();

	return stream;
};

export const streamSimpleOpenAICompletions: StreamFunction<"openai-completions", SimpleStreamOptions> = (
	model: Model<"openai-completions">,
	context: Context,
	options?: SimpleStreamOptions,
): AssistantMessageEventStream => {
	const apiKey = options?.apiKey || getEnvApiKey(model.provider);
	if (!apiKey) throw new Error(`No API key for provider: ${model.provider}`);
	const base = buildBaseOptions(model, options, apiKey);
	return streamOpenAICompletions(model, context, {
		...base,
		reasoningEffort: options?.reasoning,
		toolChoice: (options as OpenAICompletionsOptions | undefined)?.toolChoice,
	} satisfies OpenAICompletionsOptions);
};

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

function getRawErrorMetadata(error: unknown): string | undefined {
	if (typeof error !== "object" || error === null || !("error" in error)) return undefined;
	const nested = error.error;
	if (typeof nested !== "object" || nested === null || !("metadata" in nested)) return undefined;
	const metadata = nested.metadata;
	if (typeof metadata !== "object" || metadata === null || !("raw" in metadata)) return undefined;
	return metadata.raw ? String(metadata.raw) : undefined;
}
