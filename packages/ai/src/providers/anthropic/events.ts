import type Anthropic from "@anthropic-ai/sdk";
import { calculateCost } from "../../models.js";
import { AIStreamProtocolError } from "../../protocol/index.js";
import type { LanguageModelStream } from "../../runtime/language-model-adapter.js";
import type {
	AssistantMessage,
	Context,
	Model,
	StopReason,
	TextContent,
	ThinkingContent,
	ToolCall,
} from "../../types.js";
import { parseStreamingJson } from "../../utils/json-parse.js";
import { fromClaudeCodeName } from "./tools.js";

type StreamBlock = TextContent | ThinkingContent | (ToolCall & { partialJson: string });

interface ActiveBlock {
	readonly protocolIndex: number;
	readonly contentIndex?: number;
	readonly block?: StreamBlock;
}

export class AnthropicEventReducer {
	readonly #activeBlocks = new Map<number, ActiveBlock>();
	readonly #closedBlocks = new Set<number>();
	#messageStarted = false;
	#messageStopped = false;
	#stopReasonReceived = false;

	constructor(
		private readonly output: AssistantMessage,
		private readonly model: Model<"anthropic-messages">,
		private readonly context: Context,
		private readonly isOAuthToken: boolean,
		private readonly stream: LanguageModelStream,
	) {}

	consume(event: Anthropic.Messages.RawMessageStreamEvent): void {
		if (this.#messageStopped) this.#fail("Received an event after message_stop", { eventType: event.type });

		switch (event.type) {
			case "message_start":
				this.#startMessage(event);
				break;
			case "content_block_start":
				this.#requireMessageStart(event.type);
				this.#startBlock(event);
				break;
			case "content_block_delta":
				this.#requireMessageStart(event.type);
				this.#updateBlock(event);
				break;
			case "content_block_stop":
				this.#requireMessageStart(event.type);
				this.#finishBlock(event.index);
				break;
			case "message_delta":
				this.#requireMessageStart(event.type);
				if (this.#activeBlocks.size > 0) this.#fail("Received message_delta before all content blocks stopped");
				if (event.delta.stop_reason) {
					this.output.stopReason = mapStopReason(event.delta.stop_reason);
					this.#stopReasonReceived = true;
				}
				updateUsage(this.output, this.model, event.usage, true);
				break;
			case "message_stop":
				this.#requireMessageStart(event.type);
				if (this.#activeBlocks.size > 0) this.#fail("Received message_stop with open content blocks");
				if (!this.#stopReasonReceived) this.#fail("Received message_stop without a stop reason");
				this.#messageStopped = true;
				break;
			default: {
				const exhaustive: never = event;
				this.#fail("Unhandled Anthropic stream event", { event: exhaustive });
			}
		}
	}

	finish(): void {
		if (!this.#messageStarted) this.#fail("Stream ended without message_start");
		if (this.#activeBlocks.size > 0) this.#fail("Stream ended with open content blocks");
		if (!this.#messageStopped) this.#fail("Stream ended without message_stop");
	}

	#startMessage(event: Anthropic.Messages.RawMessageStartEvent): void {
		if (this.#messageStarted) this.#fail("Received duplicate message_start");
		this.#messageStarted = true;
		updateUsage(this.output, this.model, event.message.usage);
	}

	#startBlock(event: Anthropic.Messages.RawContentBlockStartEvent): void {
		if (this.#activeBlocks.has(event.index) || this.#closedBlocks.has(event.index)) {
			this.#fail("Received duplicate content_block_start", { protocolIndex: event.index });
		}

		const block = createStreamBlock(event.content_block, this.context, this.isOAuthToken);
		if (!block) {
			this.#activeBlocks.set(event.index, { protocolIndex: event.index });
			return;
		}
		const contentIndex = this.output.content.length;
		this.output.content.push(block);
		this.#activeBlocks.set(event.index, { protocolIndex: event.index, contentIndex, block });
		this.stream.push({ type: startEventType(block), contentIndex, partial: this.output });
	}

	#updateBlock(event: Anthropic.Messages.RawContentBlockDeltaEvent): void {
		const active = this.#activeBlocks.get(event.index);
		if (!active) this.#fail("Received content_block_delta for an inactive block", { protocolIndex: event.index });
		if (!active.block || active.contentIndex === undefined) return;

		const { block, contentIndex } = active;
		if (event.delta.type === "text_delta") {
			if (block.type !== "text")
				this.#fail("Received text_delta for a non-text block", { protocolIndex: event.index });
			block.text += event.delta.text;
			this.stream.push({ type: "text_delta", contentIndex, delta: event.delta.text, partial: this.output });
		} else if (event.delta.type === "thinking_delta") {
			if (block.type !== "thinking") {
				this.#fail("Received thinking_delta for a non-thinking block", { protocolIndex: event.index });
			}
			block.thinking += event.delta.thinking;
			this.stream.push({ type: "thinking_delta", contentIndex, delta: event.delta.thinking, partial: this.output });
		} else if (event.delta.type === "signature_delta") {
			if (block.type !== "thinking") {
				this.#fail("Received signature_delta for a non-thinking block", { protocolIndex: event.index });
			}
			block.thinkingSignature = (block.thinkingSignature || "") + event.delta.signature;
		} else if (event.delta.type === "input_json_delta") {
			if (block.type !== "toolCall") {
				this.#fail("Received input_json_delta for a non-tool block", { protocolIndex: event.index });
			}
			block.partialJson += event.delta.partial_json;
			block.arguments = parseStreamingJson(block.partialJson);
			this.stream.push({
				type: "toolcall_delta",
				contentIndex,
				delta: event.delta.partial_json,
				partial: this.output,
			});
		}
	}

	#finishBlock(protocolIndex: number): void {
		const active = this.#activeBlocks.get(protocolIndex);
		if (!active) this.#fail("Received content_block_stop for an inactive block", { protocolIndex });
		this.#activeBlocks.delete(protocolIndex);
		this.#closedBlocks.add(protocolIndex);
		if (!active.block || active.contentIndex === undefined) return;

		const { block, contentIndex } = active;
		if (block.type === "text") {
			this.stream.push({ type: "text_end", contentIndex, content: block.text, partial: this.output });
		} else if (block.type === "thinking") {
			this.stream.push({ type: "thinking_end", contentIndex, content: block.thinking, partial: this.output });
		} else {
			if (block.partialJson.length > 0) block.arguments = parseStreamingJson(block.partialJson);
			Reflect.deleteProperty(block, "partialJson");
			this.stream.push({ type: "toolcall_end", contentIndex, toolCall: block, partial: this.output });
		}
	}

	#requireMessageStart(eventType: string): void {
		if (!this.#messageStarted) this.#fail(`Received ${eventType} before message_start`);
	}

	#fail(message: string, metadata?: Record<string, unknown>): never {
		throw new AIStreamProtocolError(message, {
			provider: this.model.provider,
			modelId: this.model.id,
			metadata,
		});
	}
}

function createStreamBlock(
	contentBlock: Anthropic.Messages.RawContentBlockStartEvent["content_block"],
	context: Context,
	isOAuthToken: boolean,
): StreamBlock | undefined {
	if (contentBlock.type === "text") return { type: "text", text: contentBlock.text };
	if (contentBlock.type === "thinking") {
		return {
			type: "thinking",
			thinking: contentBlock.thinking,
			thinkingSignature: contentBlock.signature,
		};
	}
	if (contentBlock.type === "tool_use") {
		return {
			type: "toolCall",
			id: contentBlock.id,
			name: isOAuthToken ? fromClaudeCodeName(contentBlock.name, context.tools) : contentBlock.name,
			arguments: (contentBlock.input as Record<string, unknown>) ?? {},
			partialJson: "",
		};
	}
	return undefined;
}

function startEventType(block: StreamBlock): "text_start" | "thinking_start" | "toolcall_start" {
	if (block.type === "text") return "text_start";
	if (block.type === "thinking") return "thinking_start";
	return "toolcall_start";
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

function mapStopReason(reason: Anthropic.Messages.StopReason): StopReason {
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
			throw new Error("Anthropic refused the request");
		default: {
			const exhaustive: never = reason;
			throw new Error(`Unhandled stop reason: ${exhaustive}`);
		}
	}
}
