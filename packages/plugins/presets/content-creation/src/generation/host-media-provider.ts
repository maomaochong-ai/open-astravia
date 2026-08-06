import {
	PluginMediaError,
	type PluginMediaApi,
	type PluginMediaArtifact,
	type PluginMediaGenerationMode,
	type PluginMediaJob,
	type PluginMediaProviderDescriptor,
	type PluginMediaReference,
} from "@vetta-org/plugin-sdk";
import type {
	ContentGenerationMode,
	ContentGenerationModeId,
	ContentGenerationRequest,
	ContentModelDescriptor,
	ContentProviderAdapter,
	GeneratedContent,
} from "./types";

const HOST_MEDIA_PROVIDER_ID = "host-media";
const HOST_MEDIA_JOB_TIMEOUT_MS = 5 * 60 * 1000;
const HOST_MEDIA_POLL_INTERVAL_MS = 1000;

const TEXT_TO_IMAGE_MODE: ContentGenerationMode = {
	id: "text-to-image",
	inputs: [],
};
const IMAGE_TO_IMAGE_MODE: ContentGenerationMode = {
	id: "image-to-image",
	inputs: [{ id: "referenceImages", accepts: ["image"], minItems: 1, maxItems: 1 }],
};

export class HostMediaProvider implements ContentProviderAdapter {
	readonly id = HOST_MEDIA_PROVIDER_ID;
	private readonly providers = new Map<string, PluginMediaProviderDescriptor>();
	private readonly models: readonly ContentModelDescriptor[];

	constructor(
		private readonly media: PluginMediaApi,
		providers: readonly PluginMediaProviderDescriptor[],
	) {
		this.models = providers.flatMap((provider) => {
			const model = createImageModel(provider);
			if (!model) return [];
			this.providers.set(provider.id, provider);
			return [model];
		});
	}

	listModels(): readonly ContentModelDescriptor[] {
		return this.models;
	}

	async generate(request: ContentGenerationRequest): Promise<GeneratedContent> {
		const provider = this.providers.get(request.modelId);
		if (!provider) throw new Error(`host media provider not found: ${request.modelId}`);
		if (!isImageMode(request.modeId)) {
			throw new Error(`host media provider does not support ${request.modeId}: ${provider.id}`);
		}

		const references = request.references.map<PluginMediaReference>((reference) => {
			if (reference.kind !== "image") {
				throw new Error(`host image generation does not accept ${reference.kind} references`);
			}
			return {
				id: reference.id,
				kind: reference.kind,
				mimeType: reference.mimeType,
				data: reference.data,
			};
		});
		const job = await this.media.createJob({
			providerId: provider.id,
			kind: "image",
			mode: request.modeId,
			prompt: request.prompt,
			aspectRatio: request.aspectRatio,
			dimensions: dimensionsFromAspectRatio(request.aspectRatio),
			resolution: request.resolution,
			references,
		});
		const completed = await waitForMediaJob(this.media, job);
		const artifact = completed.artifacts?.find((candidate) => candidate.kind === "image");
		if (!artifact) {
			throw new PluginMediaError({
				code: "provider-failed",
				message: `host media provider returned no image artifact: ${provider.id}`,
				retryable: true,
			});
		}
		return generatedContentFromArtifact(artifact);
	}
}

function createImageModel(provider: PluginMediaProviderDescriptor): ContentModelDescriptor | null {
	const imageCapabilities = provider.capabilities.filter((capability) => capability.kind === "image");
	const modes = imageCapabilities
		.flatMap((capability) => capability.modes)
		.filter(isImageMode)
		.filter((mode, index, all) => all.indexOf(mode) === index)
		.map(contentModeFromMediaMode);
	if (modes.length === 0) return null;

	const aspectRatios = imageCapabilities
		.flatMap((capability) => capability.aspectRatios ?? [])
		.filter((aspectRatio, index, all) => all.indexOf(aspectRatio) === index);
	return {
		providerId: HOST_MEDIA_PROVIDER_ID,
		modelId: provider.id,
		displayName: provider.id === "desktop-app:vetta" ? "Vetta Image" : provider.id,
		outputKind: "image",
		modes,
		aspectRatios,
	};
}

function isImageMode(mode: ContentGenerationModeId | PluginMediaGenerationMode): mode is "text-to-image" | "image-to-image" {
	return mode === "text-to-image" || mode === "image-to-image";
}

function contentModeFromMediaMode(mode: "text-to-image" | "image-to-image"): ContentGenerationMode {
	return mode === "text-to-image" ? TEXT_TO_IMAGE_MODE : IMAGE_TO_IMAGE_MODE;
}

function dimensionsFromAspectRatio(aspectRatio?: string): { width: number; height: number } | undefined {
	if (!aspectRatio) return undefined;
	const [widthPart, heightPart] = aspectRatio.split(":");
	const widthRatio = Number(widthPart);
	const heightRatio = Number(heightPart);
	if (!(widthRatio > 0) || !(heightRatio > 0)) return undefined;
	const scale = 1024 / Math.min(widthRatio, heightRatio);
	return {
		width: Math.round(widthRatio * scale),
		height: Math.round(heightRatio * scale),
	};
}

async function waitForMediaJob(media: PluginMediaApi, initialJob: PluginMediaJob): Promise<PluginMediaJob> {
	let job = initialJob;
	const deadline = Date.now() + HOST_MEDIA_JOB_TIMEOUT_MS;
	while (job.status === "queued" || job.status === "running") {
		if (Date.now() >= deadline) {
			await media.cancelJob({ providerId: job.providerId, id: job.id }).catch(() => undefined);
			throw new PluginMediaError({
				code: "provider-timeout",
				message: `host media job timed out: ${job.providerId}`,
				retryable: true,
			});
		}
		await delay(HOST_MEDIA_POLL_INTERVAL_MS);
		job = await media.getJob({ providerId: job.providerId, id: job.id });
	}
	if (job.status === "failed") {
		throw new PluginMediaError(
			job.error ?? {
				code: "provider-failed",
				message: `host media job failed: ${job.providerId}`,
				retryable: true,
			},
		);
	}
	if (job.status === "cancelled") {
		throw new PluginMediaError({
			code: "cancelled",
			message: `host media job was cancelled: ${job.providerId}`,
			retryable: true,
		});
	}
	return job;
}

function generatedContentFromArtifact(artifact: PluginMediaArtifact): GeneratedContent {
	return {
		kind: "image",
		data: artifact.data,
		mimeType: artifact.mimeType,
		width: artifact.width,
		height: artifact.height,
		duration: artifact.durationSeconds,
	};
}

function delay(milliseconds: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
