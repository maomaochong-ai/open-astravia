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
import type { AssistantMessage, Model, StopReason, TextContent, ThinkingContent, ToolCall } from "../../types.js";
import type { AssistantMessageEventStream } from "../../utils/event-stream.js";
import { parseStreamingJson } from "../../utils/json-parse.js";

export type BedrockStreamBlock = (TextContent | ThinkingContent | ToolCall) & {
	index?: number;
	partialJson?: string;
};

export function handleBedrockStreamEvent(
	item: ConverseStreamOutput,
	blocks: BedrockStreamBlock[],
	output: AssistantMessage,
	stream: AssistantMessageEventStream,
	model: Model<"bedrock-converse-stream">,
): void {
	if (item.messageStart) {
		if (item.messageStart.role !== ConversationRole.ASSISTANT) {
			throw new Error("Unexpected assistant message start but got user message start instead");
		}
		stream.push({ type: "start", partial: output });
	} else if (item.contentBlockStart) {
		handleContentBlockStart(item.contentBlockStart, blocks, output, stream);
	} else if (item.contentBlockDelta) {
		handleContentBlockDelta(item.contentBlockDelta, blocks, output, stream);
	} else if (item.contentBlockStop) {
		handleContentBlockStop(item.contentBlockStop, blocks, output, stream);
	} else if (item.messageStop) {
		output.stopReason = mapStopReason(item.messageStop.stopReason);
	} else if (item.metadata) {
		handleMetadata(item.metadata, model, output);
	} else if (item.internalServerException) {
		throw new Error(`Internal server error: ${item.internalServerException.message}`);
	} else if (item.modelStreamErrorException) {
		throw new Error(`Model stream error: ${item.modelStreamErrorException.message}`);
	} else if (item.validationException) {
		throw new Error(`Validation error: ${item.validationException.message}`);
	} else if (item.throttlingException) {
		throw new Error(`Throttling error: ${item.throttlingException.message}`);
	} else if (item.serviceUnavailableException) {
		throw new Error(`Service unavailable: ${item.serviceUnavailableException.message}`);
	}
}

function handleContentBlockStart(
	event: ContentBlockStartEvent,
	blocks: BedrockStreamBlock[],
	output: AssistantMessage,
	stream: AssistantMessageEventStream,
): void {
	const start = event.start;
	if (!start?.toolUse) return;
	const block: BedrockStreamBlock = {
		type: "toolCall",
		id: start.toolUse.toolUseId || "",
		name: start.toolUse.name || "",
		arguments: {},
		partialJson: "",
		index: event.contentBlockIndex!,
	};
	blocks.push(block);
	stream.push({ type: "toolcall_start", contentIndex: blocks.length - 1, partial: output });
}

function handleContentBlockDelta(
	event: ContentBlockDeltaEvent,
	blocks: BedrockStreamBlock[],
	output: AssistantMessage,
	stream: AssistantMessageEventStream,
): void {
	const protocolIndex = event.contentBlockIndex!;
	const delta = event.delta;
	let index = blocks.findIndex((block) => block.index === protocolIndex);
	let block = blocks[index];
	if (delta?.text !== undefined) {
		if (!block) {
			block = { type: "text", text: "", index: protocolIndex };
			blocks.push(block);
			index = blocks.length - 1;
			stream.push({ type: "text_start", contentIndex: index, partial: output });
		}
		if (block.type === "text") {
			block.text += delta.text;
			stream.push({ type: "text_delta", contentIndex: index, delta: delta.text, partial: output });
		}
	} else if (delta?.toolUse && block?.type === "toolCall") {
		block.partialJson = (block.partialJson || "") + (delta.toolUse.input || "");
		block.arguments = parseStreamingJson(block.partialJson);
		stream.push({
			type: "toolcall_delta",
			contentIndex: index,
			delta: delta.toolUse.input || "",
			partial: output,
		});
	} else if (delta?.reasoningContent) {
		let thinkingBlock = block;
		let thinkingIndex = index;
		if (!thinkingBlock) {
			thinkingBlock = {
				type: "thinking",
				thinking: "",
				thinkingSignature: "",
				index: protocolIndex,
			};
			blocks.push(thinkingBlock);
			thinkingIndex = blocks.length - 1;
			stream.push({ type: "thinking_start", contentIndex: thinkingIndex, partial: output });
		}
		if (thinkingBlock.type === "thinking") {
			if (delta.reasoningContent.text) {
				thinkingBlock.thinking += delta.reasoningContent.text;
				stream.push({
					type: "thinking_delta",
					contentIndex: thinkingIndex,
					delta: delta.reasoningContent.text,
					partial: output,
				});
			}
			if (delta.reasoningContent.signature) {
				thinkingBlock.thinkingSignature =
					(thinkingBlock.thinkingSignature || "") + delta.reasoningContent.signature;
			}
		}
	}
}

function handleContentBlockStop(
	event: ContentBlockStopEvent,
	blocks: BedrockStreamBlock[],
	output: AssistantMessage,
	stream: AssistantMessageEventStream,
): void {
	const index = blocks.findIndex((block) => block.index === event.contentBlockIndex);
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
	output.usage.totalTokens = event.usage.totalTokens || output.usage.input + output.usage.output;
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
		default:
			return "error";
	}
}
