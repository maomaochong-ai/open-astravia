import type { PluginNetworkApi, PluginSettingsApi } from "@vetta-org/plugin-sdk";
import {
	delay,
	dimensionsFor,
	downloadGeneratedContent,
	requireStringSetting,
	resolveReferenceData,
} from "./adapter-utils";
import { REPLICATE_IMAGE_MODELS, REPLICATE_VIDEO_MODELS } from "./model-catalog";
import { isImageGenerationMode } from "./model-inputs";
import type {
	ContentGenerationRequest,
	ContentModelDescriptor,
	ContentProviderAdapter,
	ContentProviderGenerationContext,
	GeneratedContent,
} from "./types";

interface ReplicateProviderOptions {
	apiTokenSetting: string;
	baseUrl?: string;
	pollIntervalMs?: number;
	maxPollAttempts?: number;
}

interface ReplicatePrediction {
	id?: string;
	output?: string | string[] | null;
	status?: string;
	error?: string;
	urls?: { get?: string };
}

const SINGLE_IMAGE_INPUT_MODELS = new Set([
	"black-forest-labs/flux-kontext-pro",
	"black-forest-labs/flux-kontext-max",
]);
const OPENAI_IMAGE_INPUT_MODELS = new Set(["openai/gpt-image-1.5", "openai/gpt-image-1"]);
const TEXT_ONLY_IMAGE_MODELS = new Set(["google/imagen-4", "recraft-ai/recraft-v3"]);

export class ReplicateProvider implements ContentProviderAdapter {
	readonly id = "replicate";

	constructor(
		private readonly network: PluginNetworkApi,
		private readonly settings: PluginSettingsApi,
		private readonly options: ReplicateProviderOptions,
	) {}

	listModels(): readonly ContentModelDescriptor[] {
		return [...REPLICATE_IMAGE_MODELS, ...REPLICATE_VIDEO_MODELS];
	}

	async generate(request: ContentGenerationRequest, context: ContentProviderGenerationContext): Promise<GeneratedContent> {
		const token = requireStringSetting(this.settings, this.options.apiTokenSetting, this.id);
		const baseUrl = (this.options.baseUrl ?? "https://api.replicate.com/v1").replace(/\/$/, "");
		const imageGeneration = isImageGenerationMode(request.modeId);
		const { endpoint, input } = imageGeneration
			? await buildImageInput(request, context)
			: await buildVideoInput(request, context);
		const response = await this.network.request<ReplicatePrediction>({
			url: `${baseUrl}/models/${endpoint}/predictions`,
			method: "POST",
			headers: { Authorization: `Bearer ${token}`, Prefer: imageGeneration ? "wait" : "wait=300" },
			body: { type: "json", value: { input } },
			responseType: "json",
			timeoutMs: imageGeneration ? 120_000 : 330_000,
		});
		if (!response.ok) throw new Error(`Replicate returned HTTP ${response.status}`);
		const prediction = await this.resolvePrediction(response.body, token);
		const outputUrl = Array.isArray(prediction.output) ? prediction.output[0] : prediction.output;
		if (!outputUrl) throw new Error(prediction.error || "Replicate response is missing output");
		const dimensions = dimensionsFor(request.aspectRatio, request.resolution);
		return downloadGeneratedContent(this.network, outputUrl, {
			kind: imageGeneration ? "image" : "video",
			mimeType: imageGeneration ? "image/png" : "video/mp4",
			...dimensions,
			duration: imageGeneration ? undefined : request.duration ?? 5,
		});
	}

	private async resolvePrediction(prediction: ReplicatePrediction, token: string): Promise<ReplicatePrediction> {
		if (prediction.output) return prediction;
		if (prediction.status === "failed" || prediction.status === "canceled") {
			throw new Error(prediction.error || `Replicate prediction ${prediction.status}`);
		}
		if (!prediction.urls?.get) return prediction;
		const attempts = this.options.maxPollAttempts ?? 60;
		for (let attempt = 0; attempt < attempts; attempt += 1) {
			await delay(this.options.pollIntervalMs ?? 5_000);
			const response = await this.network.request<ReplicatePrediction>({
				url: prediction.urls.get,
				headers: { Authorization: `Bearer ${token}` },
				responseType: "json",
				timeoutMs: 15_000,
			});
			if (!response.ok) continue;
			if (response.body.output) return response.body;
			if (response.body.status === "failed" || response.body.status === "canceled") {
				throw new Error(response.body.error || `Replicate prediction ${response.body.status}`);
			}
		}
		throw new Error("Replicate generation timed out");
	}
}

async function buildImageInput(
	request: ContentGenerationRequest,
	context: ContentProviderGenerationContext,
): Promise<{ endpoint: string; input: Record<string, unknown> }> {
	const input: Record<string, unknown> = { prompt: request.prompt };
	const aspectRatio = request.aspectRatio ?? "1:1";
	if (request.modelId === "recraft-ai/recraft-v3") {
		const size = dimensionsFor(aspectRatio);
		input.size = `${size.width}x${size.height}`;
	} else {
		input.aspect_ratio = normalizeReplicateImageRatio(request.modelId, aspectRatio);
	}
	applyImageQuality(input, request.modelId, request.quality);
	const imageField = imageInputFieldForReplicateModel(request.modelId);
	const references = await resolveReferenceData(request.references, context);
	const images = references.filter((reference) => reference.kind === "image").map(toDataUrl);
	if (images.length > 0 && !imageField) throw new Error(`Replicate image model does not accept references: ${request.modelId}`);
	if (imageField === "input_image") input[imageField] = images[0];
	if (imageField === "input_images" || imageField === "image_input") input[imageField] = images;
	return { endpoint: request.modelId, input };
}

function normalizeReplicateImageRatio(modelId: string, aspectRatio: string): string {
	if (!OPENAI_IMAGE_INPUT_MODELS.has(modelId)) return aspectRatio;
	if (aspectRatio === "16:9" || aspectRatio === "4:3") return "3:2";
	if (aspectRatio === "9:16" || aspectRatio === "3:4") return "2:3";
	return "1:1";
}

function applyImageQuality(input: Record<string, unknown>, modelId: string, quality = "hd"): void {
	if (OPENAI_IMAGE_INPUT_MODELS.has(modelId)) {
		input.quality = quality === "standard" ? "medium" : "high";
		return;
	}
	const resolution = quality === "ultra" ? "4K" : quality === "standard" ? "1K" : "2K";
	if (modelId === "google/nano-banana-pro" || modelId === "google/nano-banana-2") input.resolution = resolution;
	if (modelId === "google/imagen-4") input.image_size = quality === "standard" ? "1K" : "2K";
	if (modelId === "bytedance/seedream-5-lite") input.size = quality === "ultra" ? "3K" : "2K";
	if (modelId === "bytedance/seedream-4.5") input.size = quality === "ultra" ? "4K" : "2K";
	if (modelId === "bytedance/seedream-4") input.size = resolution;
}

async function buildVideoInput(
	request: ContentGenerationRequest,
	context: ContentProviderGenerationContext,
): Promise<{ endpoint: string; input: Record<string, unknown> }> {
	const input: Record<string, unknown> = { prompt: request.prompt };
	let endpoint = request.modelId;
	const duration = request.duration ?? 5;
	const aspectRatio = request.aspectRatio ?? "16:9";
	const references = await resolveReferenceData(request.references, context);
	const images = references.filter((reference) => reference.kind === "image").map(toDataUrl);
	const video = references.find((reference) => reference.kind === "video");

	if (request.modelId === "wan-video/wan-2.6") endpoint = "wan-video/wan-2.6-t2v";
	if (request.modelId.startsWith("kwaivgi/kling-")) {
		input.duration = String(duration);
		input.aspect_ratio = aspectRatio;
		input.audio = true;
	} else if (request.modelId === "bytedance/seedance-1.5-pro") {
		input.duration = duration;
		input.aspect_ratio = aspectRatio;
		input.audio = true;
	} else if (request.modelId === "wan-video/wan-2.6") {
		input.duration = duration;
		input.aspect_ratio = aspectRatio;
		input.resolution = request.resolution ?? "720p";
		input.enable_audio = true;
	} else if (request.modelId.startsWith("openai/sora-")) {
		input.duration = duration;
		input.aspect_ratio = aspectRatio;
		input.resolution = request.resolution ?? "720p";
	} else if (request.modelId.startsWith("google/veo-")) {
		input.duration = duration;
		input.aspect_ratio = aspectRatio;
		input.generate_audio = true;
	} else if (request.modelId === "minimax/hailuo-2.3") {
		input.duration = duration;
		input.aspect_ratio = aspectRatio;
	}

	if (request.modelId === "kwaivgi/kling-v3-video" && images[0]) input.start_image = images[0];
	if (request.modelId === "kwaivgi/kling-v3-omni-video") {
		if (request.modeId === "image-to-video" && images[0]) input.start_image = images[0];
		if (request.modeId === "video-to-video") {
			if (images.length > 0) input.reference_images = images;
			if (video) input.reference_video = toDataUrl(video);
		}
	}
	if (request.modelId === "kwaivgi/kling-o1") {
		if (images.length > 0) input.reference_images = images;
		if (video) input.reference_video = toDataUrl(video);
	}
	if (request.modelId === "google/veo-3.1" || request.modelId === "google/veo-3.1-fast") {
		if (request.modeId === "image-to-video" && images[0]) input.image = images[0];
		if (request.modeId === "reference-to-video" && images.length > 0) input.reference_images = images;
	}
	return { endpoint, input };
}

function toDataUrl(reference: { data: string; mimeType: string }): string {
	return `data:${reference.mimeType};base64,${reference.data}`;
}

export function imageInputFieldForReplicateModel(modelId: string): "input_image" | "input_images" | "image_input" | null {
	if (TEXT_ONLY_IMAGE_MODELS.has(modelId)) return null;
	if (SINGLE_IMAGE_INPUT_MODELS.has(modelId)) return "input_image";
	if (OPENAI_IMAGE_INPUT_MODELS.has(modelId)) return "input_images";
	return "image_input";
}
