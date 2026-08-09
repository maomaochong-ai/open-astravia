import { calculateCost } from "../../models.js";
import { AIStreamProtocolError, type Api, type AssistantMessage } from "../../protocol/index.js";
import type { LanguageModelStream } from "../../runtime/language-model-adapter.js";
import type { Model, TextContent, ThinkingContent, ToolCall } from "../../types.js";
import { isThinkingPart, mapStopReasonString, retainThoughtSignature } from "../google-shared.js";
import type { GeminiPart, GeminiResponseChunk } from "./response-schema.js";

type ActiveTextBlock = TextContent | ThinkingContent;

export class GeminiEventReducer<TApi extends Api> {
	#currentBlock: ActiveTextBlock | undefined;
	#finishReasonReceived = false;
	#toolCallCounter = 0;

	constructor(
		private readonly output: AssistantMessage,
		private readonly model: Model<TApi>,
		private readonly stream: LanguageModelStream,
	) {}

	consume(chunk: GeminiResponseChunk): void {
		const candidate = chunk.candidates?.[0];
		if (this.#finishReasonReceived && candidate) {
			this.#fail("Received candidate data after finishReason");
		}

		for (const part of candidate?.content?.parts ?? []) {
			if (part.text !== undefined) this.#appendText(part);
			if (part.functionCall !== undefined) this.#appendToolCall(part);
		}

		if (candidate?.finishReason != null) {
			this.#closeCurrentBlock();
			this.output.stopReason = this.output.content.some((block) => block.type === "toolCall")
				? "toolUse"
				: mapStopReasonString(candidate.finishReason);
			this.#finishReasonReceived = true;
		}

		if (chunk.usageMetadata) updateUsage(this.output, this.model, chunk.usageMetadata);
	}

	finish(): void {
		this.#closeCurrentBlock();
		if (!this.#finishReasonReceived) this.#fail("Stream ended without finishReason");
		if (this.output.stopReason === "error") throw new Error("Gemini returned a failed finish reason");
	}

	#appendText(part: GeminiPart): void {
		const thinking = isThinkingPart(part);
		if (
			!this.#currentBlock ||
			(thinking && this.#currentBlock.type !== "thinking") ||
			(!thinking && this.#currentBlock.type !== "text")
		) {
			this.#closeCurrentBlock();
			this.#currentBlock = thinking
				? { type: "thinking", thinking: "", thinkingSignature: undefined }
				: { type: "text", text: "" };
			this.output.content.push(this.#currentBlock);
			this.stream.push({
				type: thinking ? "thinking_start" : "text_start",
				contentIndex: this.#contentIndex(),
				partial: this.output,
			});
		}

		if (this.#currentBlock.type === "thinking") {
			this.#currentBlock.thinking += part.text ?? "";
			this.#currentBlock.thinkingSignature = retainThoughtSignature(
				this.#currentBlock.thinkingSignature,
				part.thoughtSignature,
			);
			this.stream.push({
				type: "thinking_delta",
				contentIndex: this.#contentIndex(),
				delta: part.text ?? "",
				partial: this.output,
			});
		} else {
			this.#currentBlock.text += part.text ?? "";
			this.#currentBlock.textSignature = retainThoughtSignature(
				this.#currentBlock.textSignature,
				part.thoughtSignature,
			);
			this.stream.push({
				type: "text_delta",
				contentIndex: this.#contentIndex(),
				delta: part.text ?? "",
				partial: this.output,
			});
		}
	}

	#appendToolCall(part: GeminiPart): void {
		const functionCall = part.functionCall;
		if (!functionCall) return;
		if (functionCall.partialArgs !== undefined || functionCall.willContinue === true) {
			this.#fail("Streaming Gemini function arguments are not enabled by this adapter");
		}
		if (!functionCall.name) this.#fail("Received a functionCall without a name");
		this.#closeCurrentBlock();
		const suppliedId = functionCall.id;
		const duplicateId = suppliedId
			? this.output.content.some((block) => block.type === "toolCall" && block.id === suppliedId)
			: false;
		const id =
			!suppliedId || duplicateId ? `${functionCall.name}_${Date.now()}_${++this.#toolCallCounter}` : suppliedId;
		const toolCall: ToolCall = {
			type: "toolCall",
			id,
			name: functionCall.name,
			arguments: toToolArguments(functionCall.args),
			...(part.thoughtSignature ? { thoughtSignature: part.thoughtSignature } : {}),
		};
		this.output.content.push(toolCall);
		const contentIndex = this.#contentIndex();
		const serializedArguments = JSON.stringify(toolCall.arguments);
		this.stream.push({ type: "toolcall_start", contentIndex, partial: this.output });
		this.stream.push({ type: "toolcall_delta", contentIndex, delta: serializedArguments, partial: this.output });
		this.stream.push({ type: "toolcall_end", contentIndex, toolCall, partial: this.output });
	}

	#closeCurrentBlock(): void {
		const block = this.#currentBlock;
		if (!block) return;
		const contentIndex = this.#contentIndex();
		if (block.type === "text") {
			this.stream.push({ type: "text_end", contentIndex, content: block.text, partial: this.output });
		} else {
			this.stream.push({ type: "thinking_end", contentIndex, content: block.thinking, partial: this.output });
		}
		this.#currentBlock = undefined;
	}

	#contentIndex(): number {
		return this.output.content.length - 1;
	}

	#fail(message: string): never {
		throw new AIStreamProtocolError(message, { provider: this.model.provider, modelId: this.model.id });
	}
}

function toToolArguments(value: unknown): Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}

function updateUsage<TApi extends Api>(
	output: AssistantMessage,
	model: Model<TApi>,
	usage: NonNullable<GeminiResponseChunk["usageMetadata"]>,
): void {
	const cacheRead = usage.cachedContentTokenCount ?? 0;
	const prompt = usage.promptTokenCount ?? 0;
	output.usage = {
		input: Math.max(0, prompt - cacheRead),
		output: (usage.candidatesTokenCount ?? 0) + (usage.thoughtsTokenCount ?? 0),
		cacheRead,
		cacheWrite: 0,
		totalTokens: usage.totalTokenCount ?? 0,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
	calculateCost(model, output.usage);
}
