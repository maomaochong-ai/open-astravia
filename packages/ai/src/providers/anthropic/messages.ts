import type { ContentBlockParam, MessageParam } from "@anthropic-ai/sdk/resources/messages.js";
import type { ImageContent, Message, Model, TextContent, ToolResultMessage } from "../../types.js";
import { sanitizeSurrogates } from "../../utils/sanitize-unicode.js";
import { transformMessages } from "../transform-messages.js";
import type { AnthropicCacheControl } from "./cache.js";
import { normalizeAnthropicToolCallId, toClaudeCodeName } from "./tools.js";

type CacheableContentBlock = ContentBlockParam & { cache_control?: AnthropicCacheControl };
type AnthropicImageMediaType = "image/jpeg" | "image/png" | "image/gif" | "image/webp";

export function convertMessages(
	messages: Message[],
	model: Model<"anthropic-messages">,
	isOAuthToken: boolean,
	cacheControl?: AnthropicCacheControl,
): MessageParam[] {
	const params: MessageParam[] = [];
	const transformedMessages = transformMessages(messages, model, normalizeAnthropicToolCallId);

	for (let index = 0; index < transformedMessages.length; index++) {
		const message = transformedMessages[index];
		if (message.role === "user") {
			appendUserMessage(params, message.content, model);
		} else if (message.role === "assistant") {
			const blocks: ContentBlockParam[] = [];
			for (const block of message.content) {
				if (block.type === "text") {
					if (block.text.trim().length > 0) blocks.push({ type: "text", text: sanitizeSurrogates(block.text) });
				} else if (block.type === "thinking") {
					if (block.thinking.trim().length === 0) continue;
					if (!block.thinkingSignature || block.thinkingSignature.trim().length === 0) {
						blocks.push({ type: "text", text: sanitizeSurrogates(block.thinking) });
					} else {
						blocks.push({
							type: "thinking",
							thinking: sanitizeSurrogates(block.thinking),
							signature: block.thinkingSignature,
						});
					}
				} else {
					blocks.push({
						type: "tool_use",
						id: block.id,
						name: isOAuthToken ? toClaudeCodeName(block.name) : block.name,
						input: block.arguments ?? {},
					});
				}
			}
			if (blocks.length > 0) params.push({ role: "assistant", content: blocks });
		} else {
			const toolResults: ContentBlockParam[] = [toToolResultBlock(message)];
			let groupEnd = index + 1;
			while (groupEnd < transformedMessages.length && transformedMessages[groupEnd].role === "toolResult") {
				toolResults.push(toToolResultBlock(transformedMessages[groupEnd] as ToolResultMessage));
				groupEnd++;
			}
			index = groupEnd - 1;
			params.push({ role: "user", content: toolResults });
		}
	}

	applyCacheControl(params, cacheControl);
	return params;
}

function appendUserMessage(
	params: MessageParam[],
	content: string | (TextContent | ImageContent)[],
	model: Model<"anthropic-messages">,
): void {
	if (typeof content === "string") {
		if (content.trim().length > 0) params.push({ role: "user", content: sanitizeSurrogates(content) });
		return;
	}

	const blocks: ContentBlockParam[] = content.map((item) =>
		item.type === "text"
			? { type: "text", text: sanitizeSurrogates(item.text) }
			: {
					type: "image",
					source: {
						type: "base64",
						media_type: item.mimeType as AnthropicImageMediaType,
						data: item.data,
					},
				},
	);
	const imageCount = blocks.filter((block) => block.type === "image").length;
	if (imageCount > 0) {
		console.log(
			`[anthropic convertMessages] user msg has ${imageCount} image blocks, model.input=${JSON.stringify(model?.input)}, will filter=${!model?.input.includes("image")}`,
		);
	}
	const supportedBlocks = model.input.includes("image") ? blocks : blocks.filter((block) => block.type !== "image");
	const nonEmptyBlocks = supportedBlocks.filter((block) => block.type !== "text" || block.text.trim().length > 0);
	if (nonEmptyBlocks.length > 0) params.push({ role: "user", content: nonEmptyBlocks });
}

function toToolResultBlock(message: ToolResultMessage): ContentBlockParam {
	return {
		type: "tool_result",
		tool_use_id: message.toolCallId,
		content: convertContentBlocks(message.content),
		is_error: message.isError,
	};
}

function convertContentBlocks(content: (TextContent | ImageContent)[]):
	| string
	| Array<
			| { type: "text"; text: string }
			| {
					type: "image";
					source: {
						type: "base64";
						media_type: "image/jpeg" | "image/png" | "image/gif" | "image/webp";
						data: string;
					};
			  }
	  > {
	if (!content.some((block) => block.type === "image")) {
		return sanitizeSurrogates(content.map((block) => (block as TextContent).text).join("\n"));
	}

	const blocks = content.map((block) =>
		block.type === "text"
			? { type: "text" as const, text: sanitizeSurrogates(block.text) }
			: {
					type: "image" as const,
					source: {
						type: "base64" as const,
						media_type: block.mimeType as AnthropicImageMediaType,
						data: block.data,
					},
				},
	);
	if (!blocks.some((block) => block.type === "text")) {
		blocks.unshift({ type: "text", text: "(see attached image)" });
	}
	return blocks;
}

function applyCacheControl(params: MessageParam[], cacheControl?: AnthropicCacheControl): void {
	if (!cacheControl || params.length === 0) return;
	const lastMessage = params[params.length - 1];
	if (lastMessage.role !== "user") return;

	if (Array.isArray(lastMessage.content)) {
		const lastBlock = lastMessage.content[lastMessage.content.length - 1];
		if (lastBlock && ["text", "image", "tool_result"].includes(lastBlock.type)) {
			(lastBlock as CacheableContentBlock).cache_control = cacheControl;
		}
	} else {
		lastMessage.content = [
			{ type: "text", text: lastMessage.content, cache_control: cacheControl },
		] as MessageParam["content"];
	}
}
