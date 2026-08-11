import type OpenAI from "openai";
import type {
	ChatCompletionAssistantMessageParam,
	ChatCompletionContentPart,
	ChatCompletionContentPartImage,
	ChatCompletionContentPartText,
	ChatCompletionMessageParam,
	ChatCompletionToolMessageParam,
} from "openai/resources/chat/completions.js";
import type {
	Context,
	Model,
	OpenAICompletionsCompat,
	TextContent,
	ThinkingContent,
	Tool,
	ToolCall,
	ToolResultMessage,
} from "../../types.js";
import { sanitizeSurrogates } from "../../utils/sanitize-unicode.js";
import { transformMessages } from "../transform-messages.js";
import { sanitizeToolParameters } from "./tool-schema.js";

export function convertMessages(
	model: Model<"openai-completions">,
	context: Context,
	compat: Required<OpenAICompletionsCompat>,
): ChatCompletionMessageParam[] {
	const params: ChatCompletionMessageParam[] = [];
	const normalizeToolCallId = (id: string): string => {
		if (compat.requiresMistralToolIds) return normalizeMistralToolId(id);
		if (id.includes("|")) {
			const [callId] = id.split("|");
			return callId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40);
		}
		if (model.provider === "openai") return id.length > 40 ? id.slice(0, 40) : id;
		return id;
	};

	const transformedMessages = transformMessages(context.messages, model, normalizeToolCallId);
	if (context.systemPrompt) {
		const role = model.reasoning && compat.supportsDeveloperRole ? "developer" : "system";
		params.push({ role, content: sanitizeSurrogates(context.systemPrompt) });
	}

	let lastRole: string | null = null;
	for (let index = 0; index < transformedMessages.length; index++) {
		const message = transformedMessages[index];
		if (compat.requiresAssistantAfterToolResult && lastRole === "toolResult" && message.role === "user") {
			params.push({ role: "assistant", content: "I have processed the tool results." });
		}

		if (message.role === "user") {
			if (typeof message.content === "string") {
				params.push({ role: "user", content: sanitizeSurrogates(message.content) });
			} else {
				const content: ChatCompletionContentPart[] = message.content.map((item): ChatCompletionContentPart => {
					if (item.type === "text") {
						return {
							type: "text",
							text: sanitizeSurrogates(item.text),
						} satisfies ChatCompletionContentPartText;
					}
					return {
						type: "image_url",
						image_url: { url: `data:${item.mimeType};base64,${item.data}` },
					} satisfies ChatCompletionContentPartImage;
				});
				const filteredContent = !model.input.includes("image")
					? content.filter((item) => item.type !== "image_url")
					: content;
				if (filteredContent.length === 0) continue;
				params.push({ role: "user", content: filteredContent });
			}
		} else if (message.role === "assistant") {
			const assistantMessage: ChatCompletionAssistantMessageParam = {
				role: "assistant",
				content: compat.requiresAssistantAfterToolResult ? "" : null,
			};
			const textBlocks = message.content.filter((block) => block.type === "text") as TextContent[];
			const nonEmptyTextBlocks = textBlocks.filter((block) => block.text && block.text.trim().length > 0);
			if (nonEmptyTextBlocks.length > 0) {
				assistantMessage.content =
					model.provider === "github-copilot"
						? nonEmptyTextBlocks.map((block) => sanitizeSurrogates(block.text)).join("")
						: nonEmptyTextBlocks.map((block) => ({ type: "text", text: sanitizeSurrogates(block.text) }));
			}

			const thinkingBlocks = message.content.filter((block) => block.type === "thinking") as ThinkingContent[];
			if (thinkingBlocks.length > 0) {
				if (compat.requiresThinkingAsText) {
					const nonEmptyThinkingBlocks = thinkingBlocks.filter(
						(block) => block.thinking && block.thinking.trim().length > 0,
					);
					if (nonEmptyThinkingBlocks.length > 0) {
						const thinkingText = nonEmptyThinkingBlocks.map((block) => block.thinking).join("\n\n");
						const textContent = assistantMessage.content as Array<{ type: "text"; text: string }> | null;
						if (textContent) textContent.unshift({ type: "text", text: thinkingText });
						else assistantMessage.content = [{ type: "text", text: thinkingText }];
					}
				} else {
					const signatureBlock = thinkingBlocks.find(
						(block) => block.thinkingSignature && block.thinkingSignature.length > 0,
					);
					if (signatureBlock) {
						const signature = signatureBlock.thinkingSignature as string;
						(assistantMessage as unknown as Record<string, unknown>)[signature] = thinkingBlocks
							.map((block) => block.thinking ?? "")
							.join("\n");
					}
				}
			}

			const toolCalls = message.content.filter((block) => block.type === "toolCall") as ToolCall[];
			if (toolCalls.length > 0) {
				assistantMessage.tool_calls = toolCalls.map((toolCall) => ({
					id: toolCall.id,
					type: "function" as const,
					function: { name: toolCall.name, arguments: JSON.stringify(toolCall.arguments) },
				}));
				const reasoningDetails = toolCalls
					.filter((toolCall) => toolCall.thoughtSignature)
					.map((toolCall) => {
						try {
							return JSON.parse(toolCall.thoughtSignature as string);
						} catch {
							return null;
						}
					})
					.filter(Boolean);
				if (reasoningDetails.length > 0) {
					(assistantMessage as unknown as Record<string, unknown>).reasoning_details = reasoningDetails;
				}
			}

			const content = assistantMessage.content;
			const hasContent =
				content !== null &&
				content !== undefined &&
				(typeof content === "string" ? content.length > 0 : content.length > 0);
			if (!hasContent && !assistantMessage.tool_calls) continue;
			params.push(assistantMessage);
		} else if (message.role === "toolResult") {
			const imageBlocks: Array<{ type: "image_url"; image_url: { url: string } }> = [];
			let groupEnd = index;
			for (
				;
				groupEnd < transformedMessages.length && transformedMessages[groupEnd].role === "toolResult";
				groupEnd++
			) {
				const toolMessage = transformedMessages[groupEnd] as ToolResultMessage;
				const textResult = toolMessage.content
					.filter((content) => content.type === "text")
					.map((content) => content.text)
					.join("\n");
				const hasImages = toolMessage.content.some((content) => content.type === "image");
				const toolResultMessage: ChatCompletionToolMessageParam = {
					role: "tool",
					content: sanitizeSurrogates(textResult.length > 0 ? textResult : "(see attached image)"),
					tool_call_id: toolMessage.toolCallId,
				};
				if (compat.requiresToolResultName && toolMessage.toolName) {
					(toolResultMessage as unknown as { name?: string }).name = toolMessage.toolName;
				}
				params.push(toolResultMessage);

				if (hasImages && model.input.includes("image")) {
					for (const block of toolMessage.content) {
						if (block.type === "image") {
							imageBlocks.push({
								type: "image_url",
								image_url: { url: `data:${block.mimeType};base64,${block.data}` },
							});
						}
					}
				}
			}

			index = groupEnd - 1;
			if (imageBlocks.length > 0) {
				if (compat.requiresAssistantAfterToolResult) {
					params.push({ role: "assistant", content: "I have processed the tool results." });
				}
				params.push({
					role: "user",
					content: [{ type: "text", text: "Attached image(s) from tool result:" }, ...imageBlocks],
				});
				lastRole = "user";
			} else {
				lastRole = "toolResult";
			}
			continue;
		}

		lastRole = message.role;
	}

	return params;
}

export function convertTools(
	tools: Tool[],
	compat: Required<OpenAICompletionsCompat>,
): OpenAI.Chat.Completions.ChatCompletionTool[] {
	return tools.map((tool) => ({
		type: "function",
		function: {
			name: tool.name,
			description: tool.description,
			parameters: sanitizeToolParameters(tool.name, tool.parameters) as OpenAI.FunctionParameters,
			...(compat.supportsStrictMode !== false && { strict: false }),
		},
	}));
}

function normalizeMistralToolId(id: string): string {
	let normalized = id.replace(/[^a-zA-Z0-9]/g, "");
	if (normalized.length < 9) normalized += "ABCDEFGHI".slice(0, 9 - normalized.length);
	else if (normalized.length > 9) normalized = normalized.slice(0, 9);
	return normalized;
}
