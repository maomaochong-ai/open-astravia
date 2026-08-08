import type OpenAI from "openai";
import type {
	Tool as OpenAITool,
	ResponseInput,
	ResponseInputContent,
	ResponseInputImage,
	ResponseInputText,
	ResponseOutputMessage,
	ResponseReasoningItem,
} from "openai/resources/responses/responses.js";
import type { Api, AssistantMessage, Context, ImageContent, Model, TextContent, Tool } from "../../types.js";
import { sanitizeSurrogates } from "../../utils/sanitize-unicode.js";
import { transformMessages } from "../transform-messages.js";

export interface ConvertResponsesMessagesOptions {
	includeSystemPrompt?: boolean;
}

export interface ConvertResponsesToolsOptions {
	strict?: boolean | null;
}

export function convertResponsesMessages<TApi extends Api>(
	model: Model<TApi>,
	context: Context,
	allowedToolCallProviders: ReadonlySet<string>,
	options?: ConvertResponsesMessagesOptions,
): ResponseInput {
	const messages: ResponseInput = [];
	const transformedMessages = transformMessages(context.messages, model, (id) =>
		normalizeToolCallId(id, model.provider, allowedToolCallProviders),
	);
	if ((options?.includeSystemPrompt ?? true) && context.systemPrompt) {
		messages.push({
			role: model.reasoning ? "developer" : "system",
			content: sanitizeSurrogates(context.systemPrompt),
		});
	}

	let messageIndex = 0;
	for (const message of transformedMessages) {
		if (message.role === "user") {
			if (!appendUserMessage(messages, message.content, model)) continue;
		} else if (message.role === "assistant") {
			const output: ResponseInput = [];
			const assistantMessage = message as AssistantMessage;
			const differentModel =
				assistantMessage.model !== model.id &&
				assistantMessage.provider === model.provider &&
				assistantMessage.api === model.api;
			for (const block of message.content) {
				if (block.type === "thinking") {
					if (block.thinkingSignature) {
						output.push(JSON.parse(block.thinkingSignature) as ResponseReasoningItem);
					}
				} else if (block.type === "text") {
					let id = block.textSignature;
					if (!id) id = `msg_${messageIndex}`;
					else if (id.length > 64) id = `msg_${shortHash(id)}`;
					output.push({
						type: "message",
						role: "assistant",
						content: [{ type: "output_text", text: sanitizeSurrogates(block.text), annotations: [] }],
						status: "completed",
						id,
					} satisfies ResponseOutputMessage);
				} else {
					const [callId, rawItemId] = block.id.split("|");
					const itemId = differentModel && rawItemId?.startsWith("fc_") ? undefined : rawItemId;
					output.push({
						type: "function_call",
						id: itemId,
						call_id: callId,
						name: block.name,
						arguments: JSON.stringify(block.arguments),
					});
				}
			}
			if (output.length === 0) continue;
			messages.push(...output);
		} else {
			appendToolResult(messages, message.toolCallId, message.content, model);
		}
		messageIndex++;
	}
	return messages;
}

export function convertResponsesTools(tools: Tool[], options?: ConvertResponsesToolsOptions): OpenAITool[] {
	const strict = options?.strict === undefined ? false : options.strict;
	return tools.map((tool) => ({
		type: "function",
		name: tool.name,
		description: tool.description,
		parameters: tool.parameters as OpenAI.FunctionParameters,
		strict,
	}));
}

function appendUserMessage<TApi extends Api>(
	messages: ResponseInput,
	content: string | Array<TextContent | ImageContent>,
	model: Model<TApi>,
): boolean {
	if (typeof content === "string") {
		messages.push({
			role: "user",
			content: [{ type: "input_text", text: sanitizeSurrogates(content) }],
		});
		return true;
	}
	const parts: ResponseInputContent[] = content.map(
		(item): ResponseInputContent =>
			item.type === "text"
				? ({ type: "input_text", text: sanitizeSurrogates(item.text) } satisfies ResponseInputText)
				: ({
						type: "input_image",
						detail: "auto",
						image_url: `data:${item.mimeType};base64,${item.data}`,
					} satisfies ResponseInputImage),
	);
	const supportedParts = model.input.includes("image") ? parts : parts.filter((part) => part.type !== "input_image");
	if (supportedParts.length === 0) return false;
	messages.push({ role: "user", content: supportedParts });
	return true;
}

function appendToolResult<TApi extends Api>(
	messages: ResponseInput,
	toolCallId: string,
	content: Array<TextContent | ImageContent>,
	model: Model<TApi>,
): void {
	const text = content
		.filter((block): block is TextContent => block.type === "text")
		.map((block) => block.text)
		.join("\n");
	const images = content.filter((block): block is ImageContent => block.type === "image");
	messages.push({
		type: "function_call_output",
		call_id: toolCallId.split("|")[0],
		output: sanitizeSurrogates(text.length > 0 ? text : "(see attached image)"),
	});
	if (images.length === 0 || !model.input.includes("image")) return;
	const parts: ResponseInputContent[] = [
		{ type: "input_text", text: "Attached image(s) from tool result:" } satisfies ResponseInputText,
		...images.map(
			(block) =>
				({
					type: "input_image",
					detail: "auto",
					image_url: `data:${block.mimeType};base64,${block.data}`,
				}) satisfies ResponseInputImage,
		),
	];
	messages.push({ role: "user", content: parts });
}

function normalizeToolCallId(id: string, provider: string, allowedProviders: ReadonlySet<string>): string {
	if (!allowedProviders.has(provider) || !id.includes("|")) return id;
	const [callId, itemId] = id.split("|");
	const normalizedCallId = callId
		.replace(/[^a-zA-Z0-9_-]/g, "_")
		.slice(0, 64)
		.replace(/_+$/, "");
	let normalizedItemId = itemId.replace(/[^a-zA-Z0-9_-]/g, "_");
	if (!normalizedItemId.startsWith("fc")) normalizedItemId = `fc_${normalizedItemId}`;
	normalizedItemId = normalizedItemId.slice(0, 64).replace(/_+$/, "");
	return `${normalizedCallId}|${normalizedItemId}`;
}

function shortHash(value: string): string {
	let first = 0xdeadbeef;
	let second = 0x41c6ce57;
	for (let index = 0; index < value.length; index++) {
		const character = value.charCodeAt(index);
		first = Math.imul(first ^ character, 2654435761);
		second = Math.imul(second ^ character, 1597334677);
	}
	first = Math.imul(first ^ (first >>> 16), 2246822507) ^ Math.imul(second ^ (second >>> 13), 3266489909);
	second = Math.imul(second ^ (second >>> 16), 2246822507) ^ Math.imul(first ^ (first >>> 13), 3266489909);
	return (second >>> 0).toString(36) + (first >>> 0).toString(36);
}
