import type { ImageContent, Message, TextContent } from "@vetta/ai";

export interface ModelInputImage {
	readonly data: string;
	readonly mimeType: string;
}

export interface ModelInputImageFailure {
	readonly failed: true;
	readonly mimeType: string;
	readonly originalSizeBytes?: number;
	readonly message: string;
}

export type ModelInputImageResult = ModelInputImage | ModelInputImageFailure;

export interface ModelInputImageProcessor {
	resize(data: string, mimeType: string, signal: AbortSignal): Promise<ModelInputImageResult>;
}

export interface NormalizeModelInputImagesOptions {
	readonly processor: ModelInputImageProcessor;
}

const UNAVAILABLE_PROCESSOR: ModelInputImageProcessor = {
	async resize(data, mimeType, signal): Promise<ModelInputImageFailure> {
		signal.throwIfAborted();
		return {
			failed: true,
			mimeType,
			originalSizeBytes: estimateBase64DecodedBytes(data),
			message: "The image could not be prepared for model input because image processing is currently unavailable.",
		};
	},
};

export function resolveModelInputImageProcessor(
	processor: ModelInputImageProcessor | undefined,
): ModelInputImageProcessor {
	return processor ?? UNAVAILABLE_PROCESSOR;
}

/** 在统一模型调用边界规范化 User 与 ToolResult 图片，不修改持久化消息。 */
export async function normalizeModelInputImages(
	messages: readonly Message[],
	signal: AbortSignal,
	options: NormalizeModelInputImagesOptions,
): Promise<Message[]> {
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
			const normalized = await options.processor.resize(item.data, item.mimeType, signal);
			signal.throwIfAborted();
			if (isModelInputImageFailure(normalized)) {
				changed = true;
				content.push({ type: "text", text: formatModelInputImageFailureNote(normalized) });
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

function isModelInputImageFailure(result: ModelInputImageResult): result is ModelInputImageFailure {
	return "failed" in result;
}

function formatModelInputImageFailureNote(result: ModelInputImageFailure): string {
	return `[Image omitted: image was not sent to the model. ${result.message} Original: ${result.mimeType}, ${formatBytes(result.originalSizeBytes)}.]`;
}

function formatBytes(bytes: number | undefined): string {
	if (bytes === undefined || !Number.isFinite(bytes) || bytes < 0) return "unknown size";
	const units = ["B", "KB", "MB", "GB"] as const;
	let value = bytes;
	let unitIndex = 0;
	while (value >= 1024 && unitIndex < units.length - 1) {
		value /= 1024;
		unitIndex += 1;
	}
	return unitIndex === 0 ? `${bytes} ${units[unitIndex]}` : `${value.toFixed(1)} ${units[unitIndex]}`;
}

function estimateBase64DecodedBytes(data: string): number {
	const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
	return Math.max(0, Math.floor((data.length * 3) / 4) - padding);
}
