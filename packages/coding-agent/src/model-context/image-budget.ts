import { Buffer } from "node:buffer";
import type { AgentMessage } from "@vetta/agent-core";
import type { ImageContent, TextContent, ToolResultMessage, UserMessage } from "@vetta/ai";

const IMAGE_OMITTED_PLACEHOLDER = "[earlier image omitted to conserve memory]";
export const DEFAULT_IMAGE_REQUEST_HIGH_WATERMARK_BYTES = 16 * 1024 * 1024;
export const DEFAULT_IMAGE_REQUEST_LOW_WATERMARK_BYTES = 12 * 1024 * 1024;

export interface ImageBudgetOptions {
	readonly maxRecentImages?: number;
	readonly highWatermarkBytes?: number;
	readonly lowWatermarkBytes?: number;
}

type MessageWithImageContent = (UserMessage | ToolResultMessage) & {
	readonly content: readonly (TextContent | ImageContent)[];
};

function carriesImageContent(message: AgentMessage): message is MessageWithImageContent {
	if (!message || typeof message !== "object") return false;
	const role = (message as { role?: unknown }).role;
	if (role !== "user" && role !== "toolResult") return false;
	const content = (message as { content?: unknown }).content;
	return Array.isArray(content);
}

/** Keep recent seen images while always retaining images not yet observed by the model. */
export function applyImageBudget(messages: AgentMessage[], options: number | ImageBudgetOptions): AgentMessage[] {
	if (typeof options === "number" && (!Number.isFinite(options) || options <= 0)) return messages;
	const budget = typeof options === "number" ? options : options.maxRecentImages;

	let lastAssistantIndex = -1;
	for (let index = messages.length - 1; index >= 0; index--) {
		if ((messages[index] as { role?: unknown }).role === "assistant") {
			lastAssistantIndex = index;
			break;
		}
	}

	let remaining =
		typeof budget === "number" && Number.isFinite(budget) && budget > 0 ? budget : Number.POSITIVE_INFINITY;
	let mutated = false;
	const reversedResult: AgentMessage[] = [];

	for (let index = messages.length - 1; index >= 0; index--) {
		const message = messages[index];
		if (index > lastAssistantIndex || !carriesImageContent(message)) {
			reversedResult.push(message);
			continue;
		}

		const content = message.content;
		if (!content.some((item) => item.type === "image")) {
			reversedResult.push(message);
			continue;
		}

		let touched = false;
		const reversedContent: (TextContent | ImageContent)[] = [];
		for (let contentIndex = content.length - 1; contentIndex >= 0; contentIndex--) {
			const item = content[contentIndex];
			if (item.type !== "image") {
				reversedContent.push(item);
				continue;
			}
			if (remaining > 0) {
				remaining -= 1;
				reversedContent.push(item);
			} else {
				touched = true;
				reversedContent.push({ type: "text", text: IMAGE_OMITTED_PLACEHOLDER });
			}
		}

		if (touched) {
			mutated = true;
			reversedResult.push({ ...message, content: reversedContent.reverse() });
		} else {
			reversedResult.push(message);
		}
	}

	const countBudgeted = mutated ? reversedResult.reverse() : messages;
	const highWatermarkBytes =
		typeof options === "number"
			? DEFAULT_IMAGE_REQUEST_HIGH_WATERMARK_BYTES
			: positiveInteger(options.highWatermarkBytes, DEFAULT_IMAGE_REQUEST_HIGH_WATERMARK_BYTES);
	const lowWatermarkBytes = Math.min(
		highWatermarkBytes,
		typeof options === "number"
			? DEFAULT_IMAGE_REQUEST_LOW_WATERMARK_BYTES
			: positiveInteger(options.lowWatermarkBytes, DEFAULT_IMAGE_REQUEST_LOW_WATERMARK_BYTES),
	);
	return applyImageRequestWatermarks(countBudgeted, lastAssistantIndex, highWatermarkBytes, lowWatermarkBytes);
}

function applyImageRequestWatermarks(
	messages: AgentMessage[],
	lastAssistantIndex: number,
	highWatermarkBytes: number,
	lowWatermarkBytes: number,
): AgentMessage[] {
	let requestBytes = estimateModelMessageRequestBytes(messages);
	if (requestBytes <= highWatermarkBytes) return messages;
	const seenImages: Array<{ readonly messageIndex: number; readonly contentIndex: number }> = [];
	for (let messageIndex = 0; messageIndex < messages.length; messageIndex += 1) {
		const message = messages[messageIndex];
		if (!carriesImageContent(message)) continue;
		for (let contentIndex = 0; contentIndex < message.content.length; contentIndex += 1) {
			const item = message.content[contentIndex];
			if (item?.type !== "image") continue;
			if (messageIndex <= lastAssistantIndex) seenImages.push({ messageIndex, contentIndex });
		}
	}
	if (seenImages.length === 0) return messages;

	const omitted = new Map<number, Set<number>>();
	for (const image of seenImages) {
		if (requestBytes <= lowWatermarkBytes) break;
		let indices = omitted.get(image.messageIndex);
		if (!indices) {
			indices = new Set<number>();
			omitted.set(image.messageIndex, indices);
		}
		indices.add(image.contentIndex);
		const projectedBytes = estimateModelMessageRequestBytes(projectOmittedImages(messages, omitted));
		if (projectedBytes >= requestBytes) {
			indices.delete(image.contentIndex);
			if (indices.size === 0) omitted.delete(image.messageIndex);
			continue;
		}
		requestBytes = projectedBytes;
	}
	if (omitted.size === 0) return messages;
	return projectOmittedImages(messages, omitted);
}

function projectOmittedImages(
	messages: AgentMessage[],
	omitted: ReadonlyMap<number, ReadonlySet<number>>,
): AgentMessage[] {
	return messages.map((message, messageIndex) => {
		const indices = omitted.get(messageIndex);
		if (!indices || !carriesImageContent(message)) return message;
		return {
			...message,
			content: message.content.map((item, contentIndex) =>
				indices.has(contentIndex) ? { type: "text" as const, text: IMAGE_OMITTED_PLACEHOLDER } : item,
			),
		};
	});
}

export function estimateModelMessageRequestBytes(messages: readonly AgentMessage[]): number {
	return Buffer.byteLength(JSON.stringify(messages), "utf8");
}

function positiveInteger(value: number | undefined, fallback: number): number {
	return value !== undefined && Number.isInteger(value) && value > 0 ? value : fallback;
}
