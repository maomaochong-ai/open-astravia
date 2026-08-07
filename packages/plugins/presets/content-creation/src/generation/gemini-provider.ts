import type { PluginNetworkApi, PluginSettingsApi } from "@vetta-org/plugin-sdk";
import {
	delay,
	dimensionsFor,
	downloadGeneratedContent,
	nearestValue,
	requireStringSetting,
	resolveReferenceData,
} from "./adapter-utils";
import { GEMINI_IMAGE_MODELS, GEMINI_VIDEO_MODELS } from "./model-catalog";
import { isImageGenerationMode } from "./model-inputs";
import type {
	ContentGenerationRequest,
	ContentModelDescriptor,
	ContentProviderAdapter,
	ContentProviderGenerationContext,
	GeneratedContent,
} from "./types";

interface GeminiProviderOptions {
	apiKeySetting: string;
	baseUrl?: string;
	pollIntervalMs?: number;
	maxPollAttempts?: number;
}

interface GeminiImageResponse {
	candidates?: Array<{ content?: { parts?: Array<{ inlineData?: { data?: string; mimeType?: string } }> } }>;
	promptFeedback?: { blockReason?: string };
}

interface GeminiVideoOperation {
	name?: string;
	done?: boolean;
	error?: { message?: string };
	response?: {
		generatedVideos?: Array<{ video?: { uri?: string; mimeType?: string } }>;
		raiMediaFilteredReasons?: string[];
	};
}

export class GeminiProvider implements ContentProviderAdapter {
	readonly id = "google";

	constructor(
		private readonly network: PluginNetworkApi,
		private readonly settings: PluginSettingsApi,
		private readonly options: GeminiProviderOptions,
	) {}

	listModels(): readonly ContentModelDescriptor[] {
		return [...GEMINI_IMAGE_MODELS, ...GEMINI_VIDEO_MODELS];
	}

	async generate(request: ContentGenerationRequest, context: ContentProviderGenerationContext): Promise<GeneratedContent> {
		const apiKey = requireStringSetting(this.settings, this.options.apiKeySetting, this.id);
		return isImageGenerationMode(request.modeId)
			? this.generateImage(request, context, apiKey)
			: this.generateVideo(request, apiKey);
	}

	private async generateImage(
		request: ContentGenerationRequest,
		context: ContentProviderGenerationContext,
		apiKey: string,
	): Promise<GeneratedContent> {
		const model = apiModelId(request.modelId);
		const references = await resolveReferenceData(request.references, context);
		const response = await this.network.request<GeminiImageResponse>({
			url: `${this.baseUrl()}/models/${model}:generateContent`,
			method: "POST",
			headers: { "x-goog-api-key": apiKey },
			body: {
				type: "json",
				value: {
					contents: [
						{
							role: "user",
							parts: [
								...references.map((reference) => ({
									inlineData: { data: reference.data, mimeType: reference.mimeType },
								})),
								{ text: request.prompt },
							],
						},
					],
					generationConfig: {
						responseModalities: ["IMAGE"],
						imageConfig: {
							aspectRatio: request.aspectRatio ?? "1:1",
							imageSize: request.quality === "ultra" ? "4K" : request.quality === "standard" ? "1K" : "2K",
						},
					},
				},
			},
			responseType: "json",
			timeoutMs: 120_000,
		});
		if (!response.ok) throw new Error(`Gemini returned HTTP ${response.status}`);
		if (response.body.promptFeedback?.blockReason) {
			throw new Error(`Gemini blocked the prompt: ${response.body.promptFeedback.blockReason}`);
		}
		const inlineData = response.body.candidates?.[0]?.content?.parts?.find((part) => part.inlineData?.data)?.inlineData;
		if (!inlineData?.data) throw new Error("Gemini response is missing image data");
		return {
			kind: "image",
			source: { type: "inline", data: inlineData.data },
			mimeType: inlineData.mimeType ?? "image/png",
			...dimensionsFor(request.aspectRatio),
		};
	}

	private async generateVideo(request: ContentGenerationRequest, apiKey: string): Promise<GeneratedContent> {
		const descriptor = GEMINI_VIDEO_MODELS.find((model) => model.modelId === request.modelId);
		if (!descriptor) throw new Error(`Gemini video model is not registered: ${request.modelId}`);
		const duration = nearestValue(request.duration, descriptor.durations ?? [], 8);
		const resolution = descriptor.resolutions?.includes(request.resolution ?? "") ? request.resolution : descriptor.resolutions?.[0];
		const response = await this.network.request<GeminiVideoOperation>({
			url: `${this.baseUrl()}/models/${apiModelId(request.modelId)}:predictLongRunning`,
			method: "POST",
			headers: { "x-goog-api-key": apiKey },
			body: {
				type: "json",
				value: {
					instances: [{ prompt: request.prompt }],
					parameters: {
						aspectRatio: request.aspectRatio ?? "16:9",
						durationSeconds: duration,
						resolution: resolution ?? "720p",
						sampleCount: 1,
					},
				},
			},
			responseType: "json",
			timeoutMs: 30_000,
		});
		if (!response.ok) throw new Error(`Gemini Veo returned HTTP ${response.status}`);
		const operation = await this.resolveOperation(response.body, apiKey);
		if (operation.error?.message) throw new Error(operation.error.message);
		const generatedVideo = operation.response?.generatedVideos?.[0]?.video;
		if (!generatedVideo?.uri) {
			throw new Error(operation.response?.raiMediaFilteredReasons?.join(", ") || "Gemini Veo response is missing video data");
		}
		return downloadGeneratedContent(
			this.network,
			generatedVideo.uri,
			{
				kind: "video",
				mimeType: generatedVideo.mimeType ?? "video/mp4",
				...dimensionsFor(request.aspectRatio, resolution),
				duration,
			},
			{ "x-goog-api-key": apiKey },
		);
	}

	private async resolveOperation(operation: GeminiVideoOperation, apiKey: string): Promise<GeminiVideoOperation> {
		if (operation.done) return operation;
		if (!operation.name) throw new Error("Gemini Veo response is missing operation name");
		for (let attempt = 0; attempt < (this.options.maxPollAttempts ?? 30); attempt += 1) {
			await delay(this.options.pollIntervalMs ?? 10_000);
			const response = await this.network.request<GeminiVideoOperation>({
				url: `${this.baseUrl()}/${operation.name}`,
				headers: { "x-goog-api-key": apiKey },
				responseType: "json",
				timeoutMs: 15_000,
			});
			if (response.ok && response.body.done) return response.body;
		}
		throw new Error("Gemini Veo generation timed out");
	}

	private baseUrl(): string {
		return (this.options.baseUrl ?? "https://generativelanguage.googleapis.com/v1beta").replace(/\/$/, "");
	}
}

function apiModelId(modelId: string): string {
	return modelId.replace(/^google-official\//, "");
}
