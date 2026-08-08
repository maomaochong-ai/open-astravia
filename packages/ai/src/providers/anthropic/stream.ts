import type Anthropic from "@anthropic-ai/sdk";
import { getEnvApiKey } from "../../env-api-keys.js";
import { calculateCost } from "../../models.js";
import type {
	Api,
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
import { buildCopilotDynamicHeaders, hasCopilotVisionInput } from "../github-copilot-headers.js";
import { adjustMaxTokensForThinking, buildBaseOptions } from "../simple-options.js";
import { createAnthropicClient } from "./client.js";
import type { AnthropicOptions } from "./options.js";
import { mapThinkingLevelToEffort, supportsAdaptiveThinking } from "./options.js";
import { buildAnthropicParams } from "./request.js";
import { fromClaudeCodeName } from "./tools.js";

type StreamBlock = (ThinkingContent | TextContent | (ToolCall & { partialJson: string })) & { index: number };

export const streamAnthropic: StreamFunction<"anthropic-messages", AnthropicOptions> = (
	model: Model<"anthropic-messages">,
	context: Context,
	options?: AnthropicOptions,
): AssistantMessageEventStream => {
	const stream = new AssistantMessageEventStream();
	(async () => {
		const output = createAssistantMessage(model);
		try {
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
			);
			const params = buildAnthropicParams(model, context, isOAuthToken, options);
			options?.onPayload?.(params);
			const response = client.messages.stream({ ...params, stream: true }, { signal: options?.signal });
			stream.push({ type: "start", partial: output });
			const blocks = output.content as StreamBlock[];

			for await (const event of response) {
				processAnthropicEvent(event, blocks, output, model, context, isOAuthToken, stream);
			}
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
			stream.push({ type: "error", reason: output.stopReason, error: output });
			stream.end();
		}
	})();
	return stream;
};

export const streamSimpleAnthropic: StreamFunction<"anthropic-messages", SimpleStreamOptions> = (
	model: Model<"anthropic-messages">,
	context: Context,
	options?: SimpleStreamOptions,
): AssistantMessageEventStream => {
	const apiKey = options?.apiKey || getEnvApiKey(model.provider);
	if (!apiKey) throw new Error(`No API key for provider: ${model.provider}`);
	const base = buildBaseOptions(model, options, apiKey);
	if (!options?.reasoning) {
		return streamAnthropic(model, context, { ...base, thinkingEnabled: false } satisfies AnthropicOptions);
	}
	if (supportsAdaptiveThinking(model.id)) {
		return streamAnthropic(model, context, {
			...base,
			thinkingEnabled: true,
			effort: mapThinkingLevelToEffort(options.reasoning, model.id),
		} satisfies AnthropicOptions);
	}
	const adjusted = adjustMaxTokensForThinking(
		base.maxTokens || 0,
		model.maxTokens,
		options.reasoning,
		options.thinkingBudgets,
	);
	return streamAnthropic(model, context, {
		...base,
		maxTokens: adjusted.maxTokens,
		thinkingEnabled: true,
		thinkingBudgetTokens: adjusted.thinkingBudget,
	} satisfies AnthropicOptions);
};

function processAnthropicEvent(
	event: Anthropic.Messages.RawMessageStreamEvent,
	blocks: StreamBlock[],
	output: AssistantMessage,
	model: Model<"anthropic-messages">,
	context: Context,
	isOAuthToken: boolean,
	stream: AssistantMessageEventStream,
): void {
	if (event.type === "message_start") {
		updateUsage(output, model, event.message.usage);
	} else if (event.type === "content_block_start") {
		startBlock(event, blocks, output, context, isOAuthToken, stream);
	} else if (event.type === "content_block_delta") {
		updateBlock(event, blocks, output, stream);
	} else if (event.type === "content_block_stop") {
		finishBlock(event.index, blocks, output, stream);
	} else if (event.type === "message_delta") {
		if (event.delta.stop_reason) output.stopReason = mapStopReason(event.delta.stop_reason);
		updateUsage(output, model, event.usage, true);
	}
}

function startBlock(
	event: Anthropic.Messages.RawContentBlockStartEvent,
	blocks: StreamBlock[],
	output: AssistantMessage,
	context: Context,
	isOAuthToken: boolean,
	stream: AssistantMessageEventStream,
): void {
	let block: StreamBlock | undefined;
	let eventType: "text_start" | "thinking_start" | "toolcall_start" | undefined;
	if (event.content_block.type === "text") {
		block = { type: "text", text: "", index: event.index };
		eventType = "text_start";
	} else if (event.content_block.type === "thinking") {
		block = { type: "thinking", thinking: "", thinkingSignature: "", index: event.index };
		eventType = "thinking_start";
	} else if (event.content_block.type === "tool_use") {
		block = {
			type: "toolCall",
			id: event.content_block.id,
			name: isOAuthToken ? fromClaudeCodeName(event.content_block.name, context.tools) : event.content_block.name,
			arguments: (event.content_block.input as Record<string, unknown>) ?? {},
			partialJson: "",
			index: event.index,
		};
		eventType = "toolcall_start";
	}
	if (!block || !eventType) return;
	blocks.push(block);
	stream.push({ type: eventType, contentIndex: blocks.length - 1, partial: output });
}

function updateBlock(
	event: Anthropic.Messages.RawContentBlockDeltaEvent,
	blocks: StreamBlock[],
	output: AssistantMessage,
	stream: AssistantMessageEventStream,
): void {
	const index = blocks.findIndex((block) => block.index === event.index);
	const block = blocks[index];
	if (!block) return;
	if (event.delta.type === "text_delta" && block.type === "text") {
		block.text += event.delta.text;
		stream.push({ type: "text_delta", contentIndex: index, delta: event.delta.text, partial: output });
	} else if (event.delta.type === "thinking_delta" && block.type === "thinking") {
		block.thinking += event.delta.thinking;
		stream.push({ type: "thinking_delta", contentIndex: index, delta: event.delta.thinking, partial: output });
	} else if (event.delta.type === "input_json_delta" && block.type === "toolCall") {
		block.partialJson += event.delta.partial_json;
		block.arguments = parseStreamingJson(block.partialJson);
		stream.push({ type: "toolcall_delta", contentIndex: index, delta: event.delta.partial_json, partial: output });
	} else if (event.delta.type === "signature_delta" && block.type === "thinking") {
		block.thinkingSignature = (block.thinkingSignature || "") + event.delta.signature;
	}
}

function finishBlock(
	protocolIndex: number,
	blocks: StreamBlock[],
	output: AssistantMessage,
	stream: AssistantMessageEventStream,
): void {
	const index = blocks.findIndex((block) => block.index === protocolIndex);
	const block = blocks[index];
	if (!block) return;
	Reflect.deleteProperty(block, "index");
	if (block.type === "text") {
		stream.push({ type: "text_end", contentIndex: index, content: block.text, partial: output });
	} else if (block.type === "thinking") {
		stream.push({ type: "thinking_end", contentIndex: index, content: block.thinking, partial: output });
	} else {
		block.arguments = parseStreamingJson(block.partialJson);
		Reflect.deleteProperty(block, "partialJson");
		stream.push({ type: "toolcall_end", contentIndex: index, toolCall: block, partial: output });
	}
}

function createAssistantMessage(model: Model<"anthropic-messages">): AssistantMessage {
	return {
		role: "assistant",
		content: [],
		api: model.api as Api,
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

type AnthropicUsage = {
	input_tokens?: number | null;
	output_tokens: number;
	cache_read_input_tokens?: number | null;
	cache_creation_input_tokens?: number | null;
};

function updateUsage(
	output: AssistantMessage,
	model: Model<"anthropic-messages">,
	usage: AnthropicUsage,
	preserveMissing = false,
): void {
	if (!preserveMissing || usage.input_tokens != null) output.usage.input = usage.input_tokens || 0;
	if (!preserveMissing || usage.output_tokens != null) output.usage.output = usage.output_tokens || 0;
	if (!preserveMissing || usage.cache_read_input_tokens != null) {
		output.usage.cacheRead = usage.cache_read_input_tokens || 0;
	}
	if (!preserveMissing || usage.cache_creation_input_tokens != null) {
		output.usage.cacheWrite = usage.cache_creation_input_tokens || 0;
	}
	output.usage.totalTokens =
		output.usage.input + output.usage.output + output.usage.cacheRead + output.usage.cacheWrite;
	calculateCost(model, output.usage);
}

function mapStopReason(reason: Anthropic.Messages.StopReason | string): StopReason {
	switch (reason) {
		case "end_turn":
		case "pause_turn":
		case "stop_sequence":
			return "stop";
		case "max_tokens":
			return "length";
		case "tool_use":
			return "toolUse";
		case "refusal":
		case "sensitive":
			return "error";
		default:
			throw new Error(`Unhandled stop reason: ${reason}`);
	}
}
