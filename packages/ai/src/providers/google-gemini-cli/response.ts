import { calculateCost } from "../../models.js";
import type { AssistantMessage, Model, TextContent, ThinkingContent, ToolCall } from "../../types.js";
import type { AssistantMessageEventStream } from "../../utils/event-stream.js";
import { isThinkingPart, mapStopReasonString, retainThoughtSignature } from "../google-shared.js";
import type { CloudCodeAssistResponseChunk } from "./protocol.js";

let toolCallCounter = 0;

export async function streamGoogleCloudCodeResponse(
	response: Response,
	output: AssistantMessage,
	stream: AssistantMessageEventStream,
	model: Model<"google-gemini-cli">,
	ensureStarted: () => void,
	signal?: AbortSignal,
): Promise<boolean> {
	if (!response.body) throw new Error("No response body");
	let hasContent = false;
	let currentBlock: TextContent | ThinkingContent | null = null;
	const blocks = output.content;
	const blockIndex = () => blocks.length - 1;
	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	const abortHandler = () => {
		void reader.cancel().catch(() => {});
	};
	signal?.addEventListener("abort", abortHandler);

	try {
		while (true) {
			if (signal?.aborted) throw new Error("Request was aborted");
			const { done, value } = await reader.read();
			if (done) break;
			buffer += decoder.decode(value, { stream: true });
			const lines = buffer.split("\n");
			buffer = lines.pop() || "";
			for (const line of lines) {
				if (!line.startsWith("data:")) continue;
				const json = line.slice(5).trim();
				if (!json) continue;
				let chunk: CloudCodeAssistResponseChunk;
				try {
					chunk = JSON.parse(json) as CloudCodeAssistResponseChunk;
				} catch {
					continue;
				}
				const responseData = chunk.response;
				if (!responseData) continue;
				const candidate = responseData.candidates?.[0];
				for (const part of candidate?.content?.parts ?? []) {
					if (part.text !== undefined) {
						hasContent = true;
						const thinking = isThinkingPart(part);
						if (
							!currentBlock ||
							(thinking && currentBlock.type !== "thinking") ||
							(!thinking && currentBlock.type !== "text")
						) {
							finishCurrentBlock(currentBlock, output, stream, blockIndex());
							currentBlock = thinking
								? { type: "thinking", thinking: "", thinkingSignature: undefined }
								: { type: "text", text: "" };
							blocks.push(currentBlock);
							ensureStarted();
							stream.push({
								type: thinking ? "thinking_start" : "text_start",
								contentIndex: blockIndex(),
								partial: output,
							});
						}
						if (currentBlock.type === "thinking") {
							currentBlock.thinking += part.text;
							currentBlock.thinkingSignature = retainThoughtSignature(
								currentBlock.thinkingSignature,
								part.thoughtSignature,
							);
							stream.push({
								type: "thinking_delta",
								contentIndex: blockIndex(),
								delta: part.text,
								partial: output,
							});
						} else {
							currentBlock.text += part.text;
							currentBlock.textSignature = retainThoughtSignature(
								currentBlock.textSignature,
								part.thoughtSignature,
							);
							stream.push({
								type: "text_delta",
								contentIndex: blockIndex(),
								delta: part.text,
								partial: output,
							});
						}
					}

					if (part.functionCall) {
						hasContent = true;
						finishCurrentBlock(currentBlock, output, stream, blockIndex());
						currentBlock = null;
						const providedId = part.functionCall.id;
						const needsNewId =
							!providedId || blocks.some((block) => block.type === "toolCall" && block.id === providedId);
						const toolCall: ToolCall = {
							type: "toolCall",
							id: needsNewId ? `${part.functionCall.name}_${Date.now()}_${++toolCallCounter}` : providedId,
							name: part.functionCall.name || "",
							arguments: part.functionCall.args ?? {},
							...(part.thoughtSignature && { thoughtSignature: part.thoughtSignature }),
						};
						blocks.push(toolCall);
						ensureStarted();
						stream.push({ type: "toolcall_start", contentIndex: blockIndex(), partial: output });
						stream.push({
							type: "toolcall_delta",
							contentIndex: blockIndex(),
							delta: JSON.stringify(toolCall.arguments),
							partial: output,
						});
						stream.push({
							type: "toolcall_end",
							contentIndex: blockIndex(),
							toolCall,
							partial: output,
						});
					}
				}

				if (candidate?.finishReason) {
					output.stopReason = blocks.some((block) => block.type === "toolCall")
						? "toolUse"
						: mapStopReasonString(candidate.finishReason);
				}
				if (responseData.usageMetadata) updateUsage(output, model, responseData.usageMetadata);
			}
		}
	} finally {
		signal?.removeEventListener("abort", abortHandler);
	}

	finishCurrentBlock(currentBlock, output, stream, blockIndex());
	return hasContent;
}

function finishCurrentBlock(
	block: TextContent | ThinkingContent | null,
	output: AssistantMessage,
	stream: AssistantMessageEventStream,
	contentIndex: number,
): void {
	if (!block) return;
	if (block.type === "text") {
		stream.push({ type: "text_end", contentIndex, content: block.text, partial: output });
	} else {
		stream.push({ type: "thinking_end", contentIndex, content: block.thinking, partial: output });
	}
}

function updateUsage(
	output: AssistantMessage,
	model: Model<"google-gemini-cli">,
	usage: NonNullable<NonNullable<CloudCodeAssistResponseChunk["response"]>["usageMetadata"]>,
): void {
	const promptTokens = usage.promptTokenCount || 0;
	const cacheReadTokens = usage.cachedContentTokenCount || 0;
	output.usage = {
		input: promptTokens - cacheReadTokens,
		output: (usage.candidatesTokenCount || 0) + (usage.thoughtsTokenCount || 0),
		cacheRead: cacheReadTokens,
		cacheWrite: 0,
		totalTokens: usage.totalTokenCount || 0,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
	calculateCost(model, output.usage);
}
