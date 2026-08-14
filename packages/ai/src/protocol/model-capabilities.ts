import type { ImageContent } from "./message.js";

export type ModelInputCapability = "text" | "image" | "file" | "audio" | "video";

export interface ModelCapabilities {
	readonly streaming: boolean;
	readonly tools: boolean;
	readonly structuredOutput: boolean;
	readonly reasoning: boolean;
	readonly parallelToolCalls: boolean;
	readonly input: readonly ModelInputCapability[];
	readonly supportedUrls?: readonly string[];
}

export interface ModelLimits {
	readonly contextWindow: number;
	readonly maxTokens: number;
}

export function modelAcceptsImage(capabilities: ModelCapabilities): boolean {
	return capabilities.input.includes("image");
}

export function hasImageInput(content: readonly unknown[]): boolean {
	return content.some((part) => isImageContent(part));
}

function isImageContent(value: unknown): value is ImageContent {
	return (
		typeof value === "object" && value !== null && "type" in value && (value as { type?: unknown }).type === "image"
	);
}
