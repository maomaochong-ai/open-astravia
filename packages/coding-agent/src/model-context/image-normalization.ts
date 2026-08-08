import { Buffer } from "node:buffer";
import type { ImageContent, Message, TextContent } from "@vetta/ai";
import {
	formatImageResizeFailureNote,
	type ImageResizeResult,
	isImageResizeFailure,
	resizeImageBuffer,
} from "@vetta/runtime-tools/coding";

export interface ModelInputImageProcessor {
	resize(data: string, mimeType: string, signal: AbortSignal): Promise<ImageResizeResult>;
}

export interface NormalizeModelInputImagesOptions {
	readonly processor?: ModelInputImageProcessor;
}

const DEFAULT_PROCESSOR: ModelInputImageProcessor = {
	async resize(data, mimeType, signal) {
		signal.throwIfAborted();
		return resizeImageBuffer(Buffer.from(data, "base64"), mimeType, undefined, data);
	},
};

/** 在统一模型调用边界规范化 User 与 ToolResult 图片，不修改持久化消息。 */
export async function normalizeModelInputImages(
	messages: readonly Message[],
	signal: AbortSignal,
	options: NormalizeModelInputImagesOptions = {},
): Promise<Message[]> {
	const processor = options.processor ?? DEFAULT_PROCESSOR;
	const result: Message[] = [];
	for (const message of messages) {
		signal.throwIfAborted();
		if (message.role !== "user" && message.role !== "toolResult") {
			result.push(message);
			continue;
		}
		if (!Array.isArray(message.content) || !message.content.some((item) => item.type === "image")) {
			result.push(message);
			continue;
		}

		let changed = false;
		const content: (TextContent | ImageContent)[] = [];
		for (const item of message.content) {
			if (item.type !== "image") {
				content.push(item);
				continue;
			}
			const normalized = await processor.resize(item.data, item.mimeType, signal);
			signal.throwIfAborted();
			if (isImageResizeFailure(normalized)) {
				changed = true;
				content.push({ type: "text", text: formatImageResizeFailureNote(normalized) });
				continue;
			}
			if (normalized.data === item.data && normalized.mimeType === item.mimeType) {
				content.push(item);
				continue;
			}
			changed = true;
			content.push({ type: "image", data: normalized.data, mimeType: normalized.mimeType });
		}
		result.push(changed ? { ...message, content } : message);
	}
	return result;
}
