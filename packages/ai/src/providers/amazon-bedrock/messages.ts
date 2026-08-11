import {
	CachePointType,
	CacheTTL,
	type ContentBlock,
	ConversationRole,
	ImageFormat,
	type Message,
	type SystemContentBlock,
	ToolResultStatus,
} from "@aws-sdk/client-bedrock-runtime";
import type { CacheRetention, Context, JsonValue, Model, ToolResultMessage } from "../../types.js";
import { sanitizeSurrogates } from "../../utils/sanitize-unicode.js";
import { transformMessages } from "../transform-messages.js";

export function resolveCacheRetention(cacheRetention?: CacheRetention): CacheRetention {
	if (cacheRetention) return cacheRetention;
	if (typeof process !== "undefined" && process.env.PI_CACHE_RETENTION === "long") return "long";
	return "short";
}

export function buildSystemPrompt(
	systemPrompt: string | undefined,
	model: Model<"bedrock-converse-stream">,
	cacheRetention: CacheRetention,
): SystemContentBlock[] | undefined {
	if (!systemPrompt) return undefined;
	const blocks: SystemContentBlock[] = [{ text: sanitizeSurrogates(systemPrompt) }];
	if (cacheRetention !== "none" && supportsPromptCaching(model)) {
		blocks.push({
			cachePoint: {
				type: CachePointType.DEFAULT,
				...(cacheRetention === "long" ? { ttl: CacheTTL.ONE_HOUR } : {}),
			},
		});
	}
	return blocks;
}

export function convertBedrockMessages(
	context: Context,
	model: Model<"bedrock-converse-stream">,
	cacheRetention: CacheRetention,
): Message[] {
	const result: Message[] = [];
	const messages = transformMessages(context.messages, model, normalizeToolCallId);
	for (let index = 0; index < messages.length; index++) {
		const message = messages[index];
		if (message.role === "user") {
			result.push({
				role: ConversationRole.USER,
				content:
					typeof message.content === "string"
						? [{ text: sanitizeSurrogates(message.content) }]
						: message.content.map((content) =>
								content.type === "text"
									? { text: sanitizeSurrogates(content.text) }
									: { image: createImageBlock(content.mimeType, content.data) },
							),
			});
		} else if (message.role === "assistant") {
			const contentBlocks: ContentBlock[] = [];
			for (const content of message.content) {
				if (content.type === "text") {
					if (content.text.trim().length > 0) contentBlocks.push({ text: sanitizeSurrogates(content.text) });
				} else if (content.type === "toolCall") {
					contentBlocks.push({
						toolUse: { toolUseId: content.id, name: content.name, input: toJsonValue(content.arguments) },
					});
				} else if (content.thinking.trim().length > 0) {
					contentBlocks.push({
						reasoningContent: {
							reasoningText: {
								text: sanitizeSurrogates(content.thinking),
								...(supportsThinkingSignature(model) ? { signature: content.thinkingSignature } : {}),
							},
						},
					});
				}
			}
			if (contentBlocks.length > 0) {
				result.push({ role: ConversationRole.ASSISTANT, content: contentBlocks });
			}
		} else {
			const toolResults: ContentBlock.ToolResultMember[] = [toToolResult(message)];
			let groupEnd = index + 1;
			while (groupEnd < messages.length && messages[groupEnd].role === "toolResult") {
				toolResults.push(toToolResult(messages[groupEnd] as ToolResultMessage));
				groupEnd++;
			}
			index = groupEnd - 1;
			result.push({ role: ConversationRole.USER, content: toolResults });
		}
	}

	if (cacheRetention !== "none" && supportsPromptCaching(model) && result.length > 0) {
		const lastMessage = result[result.length - 1];
		if (lastMessage.role === ConversationRole.USER && lastMessage.content) {
			(lastMessage.content as ContentBlock[]).push({
				cachePoint: {
					type: CachePointType.DEFAULT,
					...(cacheRetention === "long" ? { ttl: CacheTTL.ONE_HOUR } : {}),
				},
			});
		}
	}
	return result;
}

function toToolResult(message: ToolResultMessage): ContentBlock.ToolResultMember {
	return {
		toolResult: {
			toolUseId: message.toolCallId,
			content: message.content.map((content) =>
				content.type === "image"
					? { image: createImageBlock(content.mimeType, content.data) }
					: { text: sanitizeSurrogates(content.text) },
			),
			status: message.isError ? ToolResultStatus.ERROR : ToolResultStatus.SUCCESS,
		},
	};
}

function supportsPromptCaching(model: Model<"bedrock-converse-stream">): boolean {
	if (model.cost.cacheRead || model.cost.cacheWrite) return true;
	const id = model.id.toLowerCase();
	if (id.includes("claude") && (id.includes("-4-") || id.includes("-4."))) return true;
	return id.includes("claude-3-7-sonnet") || id.includes("claude-3-5-haiku");
}

function supportsThinkingSignature(model: Model<"bedrock-converse-stream">): boolean {
	const id = model.id.toLowerCase();
	return id.includes("anthropic.claude") || id.includes("anthropic/claude");
}

function normalizeToolCallId(id: string): string {
	return id.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
}

function toJsonValue(value: unknown): JsonValue {
	if (value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string") {
		return value;
	}
	if (Array.isArray(value)) return value.map(toJsonValue);
	if (typeof value === "object") {
		const result: Record<string, JsonValue> = {};
		for (const [key, entry] of Object.entries(value)) result[key] = toJsonValue(entry);
		return result;
	}
	throw new TypeError(`Bedrock tool arguments must contain JSON values, received ${typeof value}`);
}

function createImageBlock(mimeType: string, data: string): { source: { bytes: Uint8Array }; format: ImageFormat } {
	let format: ImageFormat;
	switch (mimeType) {
		case "image/jpeg":
		case "image/jpg":
			format = ImageFormat.JPEG;
			break;
		case "image/png":
			format = ImageFormat.PNG;
			break;
		case "image/gif":
			format = ImageFormat.GIF;
			break;
		case "image/webp":
			format = ImageFormat.WEBP;
			break;
		default:
			throw new Error(`Unknown image type: ${mimeType}`);
	}
	const binary = atob(data);
	const bytes = new Uint8Array(binary.length);
	for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
	return { source: { bytes }, format };
}
