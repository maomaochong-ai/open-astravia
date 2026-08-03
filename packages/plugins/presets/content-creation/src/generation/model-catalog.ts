import type { ContentGenerationCapability, ContentModelDescriptor } from "./types";

const IMAGE_RATIOS = ["1:1", "16:9", "9:16", "4:3", "3:4"] as const;
const VIDEO_RATIOS = ["16:9", "9:16"] as const;

function imageModel(providerId: string, modelId: string, displayName: string): ContentModelDescriptor {
	return {
		providerId,
		modelId,
		displayName,
		capabilities: ["text-to-image"],
		aspectRatios: IMAGE_RATIOS,
	};
}

function videoModel(
	providerId: string,
	modelId: string,
	displayName: string,
	durations: readonly number[],
	resolutions: readonly string[],
	capability: ContentGenerationCapability = "text-to-video",
): ContentModelDescriptor {
	return {
		providerId,
		modelId,
		displayName,
		capabilities: [capability],
		aspectRatios: VIDEO_RATIOS,
		durations,
		resolutions,
	};
}

export const OPENAI_IMAGE_MODELS = [
	imageModel("openai", "gpt-image-2", "GPT Image 2"),
	imageModel("openai", "gpt-image-1.5", "GPT Image 1.5"),
	imageModel("openai", "gpt-image-1", "GPT Image 1"),
] as const;

export const REPLICATE_IMAGE_MODELS = [
	imageModel("replicate", "google/nano-banana-pro", "Nano Banana Pro"),
	imageModel("replicate", "google/nano-banana-2", "Nano Banana 2"),
	imageModel("replicate", "google/nano-banana", "Nano Banana"),
	imageModel("replicate", "google/imagen-4", "Imagen 4"),
	imageModel("replicate", "openai/gpt-image-1.5", "GPT Image 1.5"),
	imageModel("replicate", "black-forest-labs/flux-kontext-max", "Flux Kontext Max"),
	imageModel("replicate", "black-forest-labs/flux-kontext-pro", "Flux Kontext Pro"),
	imageModel("replicate", "bytedance/seedream-5-lite", "Seedream 5.0 Lite"),
	imageModel("replicate", "bytedance/seedream-4.5", "Seedream 4.5"),
	imageModel("replicate", "bytedance/seedream-4", "Seedream 4"),
	imageModel("replicate", "recraft-ai/recraft-v3", "Recraft V3"),
] as const;

export const REPLICATE_VIDEO_MODELS = [
	videoModel("replicate", "kwaivgi/kling-v3-video", "Kling 3.0", [5, 10, 15], ["720p", "1080p"]),
	videoModel("replicate", "kwaivgi/kling-v3-omni-video", "Kling 3.0 Omni", [5, 10, 15], ["720p", "1080p"]),
	videoModel("replicate", "kwaivgi/kling-v2.6", "Kling 2.6", [5, 10], ["720p", "1080p"]),
	videoModel("replicate", "kwaivgi/kling-o1", "Kling O1", [3, 5, 10], ["720p", "1080p", "4k"], "video-to-video"),
	videoModel("replicate", "bytedance/seedance-1.5-pro", "Seedance 1.5 Pro", [5, 10], ["720p", "1080p"]),
	videoModel("replicate", "wan-video/wan-2.6", "Wan 2.6", [5, 10], ["720p", "1080p"]),
	videoModel("replicate", "openai/sora-2", "Sora 2", [4, 6, 8, 10, 12], ["720p", "1080p"]),
	videoModel("replicate", "openai/sora-2-pro", "Sora 2 Pro", [4, 6, 8, 10, 12], ["720p", "1080p"]),
	videoModel("replicate", "google/veo-3", "Veo 3", [8], ["720p", "1080p"]),
	videoModel("replicate", "google/veo-3.1", "Veo 3.1", [4, 6, 8], ["720p", "1080p"]),
	videoModel("replicate", "google/veo-3.1-fast", "Veo 3.1 Fast", [4, 6, 8], ["720p", "1080p"]),
	videoModel("replicate", "minimax/hailuo-2.3", "Hailuo 2.3", [6, 10], ["720p", "1080p"]),
] as const;

export const GEMINI_IMAGE_MODELS = [
	imageModel("google", "google-official/gemini-3-pro-image-preview", "Nano Banana Pro"),
	imageModel("google", "google-official/gemini-3.1-flash-image-preview", "Nano Banana 2"),
	imageModel("google", "google-official/gemini-2.5-flash-image", "Nano Banana"),
] as const;

export const GEMINI_VIDEO_MODELS = [
	videoModel("google", "google-official/veo-3.1-generate-preview", "Veo 3.1", [4, 6, 8], ["720p", "1080p", "4k"]),
	videoModel("google", "google-official/veo-3.1-fast-generate-preview", "Veo 3.1 Fast", [4, 6, 8], ["720p", "1080p", "4k"]),
	videoModel("google", "google-official/veo-3.1-lite-generate-preview", "Veo 3.1 Lite", [4, 6, 8], ["720p", "1080p"]),
	videoModel("google", "google-official/veo-3.0-generate-001", "Veo 3", [4, 6, 8], ["720p", "1080p", "4k"]),
	videoModel("google", "google-official/veo-3.0-fast-generate-001", "Veo 3 Fast", [4, 6, 8], ["720p", "1080p", "4k"]),
	videoModel("google", "google-official/veo-2.0-generate-001", "Veo 2", [5, 6, 7, 8], ["720p"]),
] as const;
