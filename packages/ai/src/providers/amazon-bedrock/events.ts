import {
	StopReason as BedrockStopReason,
	type ContentBlockDeltaEvent,
	type ContentBlockStartEvent,
	type ContentBlockStopEvent,
	ConversationRole,
	type ConverseStreamMetadataEvent,
	type ConverseStreamOutput,
} from "@aws-sdk/client-bedrock-runtime";
import { calculateCost } from "../../models.js";
import { AIStreamProtocolError } from "../../protocol/index.js";
import type { LanguageModelStream } from "../../runtime/language-model-adapter.js";
import type { AssistantMessage, Model, StopReason, TextContent, ThinkingContent, ToolCall } from "../../types.js";
import { parseStreamingJson } from "../../utils/json-parse.js";

type BedrockStreamBlock = (TextContent | ThinkingContent | ToolCall) & { partialJson?: string };

interface ActiveBlock {
	readonly protocolIndex: number;
	readonly contentIndex?: number;
	readonly block?: BedrockStreamBlock;
}

export class BedrockEventReducer {
	readonly #activeBlocks = new Map<number, ActiveBlock>();
	readonly #closedBlocks = new Set<number>();
	#messageStarted = false;
	#messageStopped = false;

	constructor(
		private readonly output: AssistantMessage,
		private readonly stream: LanguageModelStream,
		private readonly model: Model<"bedrock-converse-stream">,
	) {}

	consume(item: ConverseStreamOutput): void {
		if (this.#messageStopped && !item.metadata) {
			this.#fail("Received an event after messageStop");
		}

		if (item.messageStart) {
			this.#startMessage(item.messageStart.role);
		} else if (item.contentBlockStart) {
			this.#requireMessageStart("contentBlockStart");
			this.#startBlock(item.contentBlockStart);
		} else if (item.contentBlockDelta) {
			this.#requireMessageStart("contentBlockDelta");
			this.#updateBlock(item.contentBlockDelta);
		} else if (item.contentBlockStop) {
			this.#requireMessageStart("contentBlockStop");
			this.#finishBlock(item.contentBlockStop);
		} else if (item.messageStop) {
			this.#requireMessageStart("messageStop");
			if (this.#activeBlocks.size > 0) this.#fail("Received messageStop with open content blocks");
			this.output.stopReason = mapStopReason(item.messageStop.stopReason);
			this.#messageStopped = true;
		} else if (item.metadata) {
			this.#requireMessageStart("metadata");
			handleMetadata(item.metadata, this.model, this.output);
		} else if (item.internalServerException) {
			throw bedrockEventError("Internal server error", item.internalServerException.message, 500);
		} else if (item.modelStreamErrorException) {
			throw bedrockEventError("Model stream error", item.modelStreamErrorException.message, 500);
		} else if (item.validationException) {
			throw bedrockEventError("Validation error", item.validationException.message, 400);
		} else if (item.throttlingException) {
			throw bedrockEventError("Throttling error", item.throttlingException.message, 429);
		} else if (item.serviceUnavailableException) {
			throw bedrockEventError("Service unavailable", item.serviceUnavailableException.message, 503);
		} else {
			this.#fail("Received an unknown Bedrock Converse stream event");
		}
	}

	finish(): void {
		if (!this.#messageStarted) this.#fail("Stream ended without messageStart");
		if (this.#activeBlocks.size > 0) this.#fail("Stream ended with open content blocks");
		if (!this.#messageStopped) this.#fail("Stream ended without messageStop");
	}

	#startMessage(role: string | undefined): void {
		if (this.#messageStarted) this.#fail("Received duplicate messageStart");
		if (role !== ConversationRole.ASSISTANT) this.#fail("Bedrock messageStart role must be assistant", { role });
		this.#messageStarted = true;
		this.stream.push({ type: "start", partial: this.output });
	}

	#startBlock(event: ContentBlockStartEvent): void {
		const protocolIndex = requireProtocolIndex(event.contentBlockIndex, "contentBlockStart", this.#fail.bind(this));
		if (this.#activeBlocks.has(protocolIndex) || this.#closedBlocks.has(protocolIndex)) {
			this.#fail("Received duplicate contentBlockStart", { protocolIndex });
		}
		const toolUse = event.start?.toolUse;
		if (!toolUse) {
			this.#activeBlocks.set(protocolIndex, { protocolIndex });
			return;
		}
		const block: BedrockStreamBlock = {
			type: "toolCall",
			id: toolUse.toolUseId || "",
			name: toolUse.name || "",
			arguments: {},
			partialJson: "",
		};
		const contentIndex = this.output.content.length;
		this.output.content.push(block);
		this.#activeBlocks.set(protocolIndex, { protocolIndex, contentIndex, block });
		this.stream.push({ type: "toolcall_start", contentIndex, partial: this.output });
	}

	#updateBlock(event: ContentBlockDeltaEvent): void {
		const protocolIndex = requireProtocolIndex(event.contentBlockIndex, "contentBlockDelta", this.#fail.bind(this));
		const delta = event.delta;
		if (!delta) this.#fail("Bedrock contentBlockDelta is missing delta", { protocolIndex });
		let active = this.#activeBlocks.get(protocolIndex);
		if (!active) {
			if (this.#closedBlocks.has(protocolIndex)) {
				this.#fail("Received contentBlockDelta for a closed block", { protocolIndex });
			}
			const block = createDeltaStartedBlock(delta);
			if (!block) {
				this.#activeBlocks.set(protocolIndex, { protocolIndex });
				return;
			}
			const contentIndex = this.output.content.length;
			this.output.content.push(block);
			active = { protocolIndex, contentIndex, block };
			this.#activeBlocks.set(protocolIndex, active);
			this.stream.push({ type: startEventType(block), contentIndex, partial: this.output });
		}
		if (!active.block || active.contentIndex === undefined) return;

		const { block, contentIndex } = active;
		if (delta.text !== undefined) {
			if (block.type !== "text") this.#fail("Received text delta for a non-text block", { protocolIndex });
			block.text += delta.text;
			this.stream.push({ type: "text_delta", contentIndex, delta: delta.text, partial: this.output });
		} else if (delta.toolUse) {
			if (block.type !== "toolCall") this.#fail("Received tool delta for a non-tool block", { protocolIndex });
			const value = delta.toolUse.input || "";
			block.partialJson = (block.partialJson || "") + value;
			block.arguments = parseStreamingJson(block.partialJson);
			this.stream.push({ type: "toolcall_delta", contentIndex, delta: value, partial: this.output });
		} else if (delta.reasoningContent) {
			if (block.type !== "thinking") {
				this.#fail("Received reasoning delta for a non-thinking block", { protocolIndex });
			}
			if (delta.reasoningContent.text) {
				block.thinking += delta.reasoningContent.text;
				this.stream.push({
					type: "thinking_delta",
					contentIndex,
					delta: delta.reasoningContent.text,
					partial: this.output,
				});
			}
			if (delta.reasoningContent.signature) {
				block.thinkingSignature = (block.thinkingSignature || "") + delta.reasoningContent.signature;
			}
		}
	}

	#finishBlock(event: ContentBlockStopEvent): void {
		const protocolIndex = requireProtocolIndex(event.contentBlockIndex, "contentBlockStop", this.#fail.bind(this));
		const active = this.#activeBlocks.get(protocolIndex);
		if (!active) this.#fail("Received contentBlockStop for an inactive block", { protocolIndex });
		this.#activeBlocks.delete(protocolIndex);
		this.#closedBlocks.add(protocolIndex);
		if (!active.block || active.contentIndex === undefined) return;

		const { block, contentIndex } = active;
		if (block.type === "text") {
			this.stream.push({ type: "text_end", contentIndex, content: block.text, partial: this.output });
		} else if (block.type === "thinking") {
			this.stream.push({ type: "thinking_end", contentIndex, content: block.thinking, partial: this.output });
		} else {
			if (block.partialJson) block.arguments = parseStreamingJson(block.partialJson);
			Reflect.deleteProperty(block, "partialJson");
			this.stream.push({ type: "toolcall_end", contentIndex, toolCall: block, partial: this.output });
		}
	}

	#requireMessageStart(eventType: string): void {
		if (!this.#messageStarted) this.#fail(`Received ${eventType} before messageStart`);
	}

	#fail(message: string, metadata?: Record<string, unknown>): never {
		throw new AIStreamProtocolError(message, {
			provider: this.model.provider,
			modelId: this.model.id,
			metadata,
		});
	}
}

function createDeltaStartedBlock(delta: NonNullable<ContentBlockDeltaEvent["delta"]>): BedrockStreamBlock | undefined {
	if (delta.text !== undefined) return { type: "text", text: "" };
	if (delta.reasoningContent) {
		return { type: "thinking", thinking: "", thinkingSignature: "" };
	}
	return undefined;
}

function startEventType(block: BedrockStreamBlock): "text_start" | "thinking_start" | "toolcall_start" {
	if (block.type === "text") return "text_start";
	if (block.type === "thinking") return "thinking_start";
	return "toolcall_start";
}

function requireProtocolIndex(
	value: number | undefined,
	eventType: string,
	fail: (message: string, metadata?: Record<string, unknown>) => never,
): number {
	if (value === undefined) fail(`${eventType} is missing contentBlockIndex`);
	return value;
}

function handleMetadata(
	event: ConverseStreamMetadataEvent,
	model: Model<"bedrock-converse-stream">,
	output: AssistantMessage,
): void {
	if (!event.usage) return;
	output.usage.input = event.usage.inputTokens || 0;
	output.usage.output = event.usage.outputTokens || 0;
	output.usage.cacheRead = event.usage.cacheReadInputTokens || 0;
	output.usage.cacheWrite = event.usage.cacheWriteInputTokens || 0;
	output.usage.totalTokens =
		event.usage.totalTokens ||
		output.usage.input + output.usage.output + output.usage.cacheRead + output.usage.cacheWrite;
	calculateCost(model, output.usage);
}

function mapStopReason(reason: string | undefined): StopReason {
	switch (reason) {
		case BedrockStopReason.END_TURN:
		case BedrockStopReason.STOP_SEQUENCE:
			return "stop";
		case BedrockStopReason.MAX_TOKENS:
		case BedrockStopReason.MODEL_CONTEXT_WINDOW_EXCEEDED:
			return "length";
		case BedrockStopReason.TOOL_USE:
			return "toolUse";
		case BedrockStopReason.CONTENT_FILTERED:
		case BedrockStopReason.GUARDRAIL_INTERVENED:
		case BedrockStopReason.MALFORMED_MODEL_OUTPUT:
		case BedrockStopReason.MALFORMED_TOOL_USE:
			throw new Error(`Bedrock stopped with provider failure: ${reason}`);
		default:
			throw new AIStreamProtocolError(`Unhandled Bedrock stop reason: ${reason ?? "missing"}`);
	}
}

function bedrockEventError(prefix: string, message: string | undefined, status: number): Error & { status: number } {
	return Object.assign(new Error(`${prefix}: ${message || "Unknown error"}`), { status });
}
