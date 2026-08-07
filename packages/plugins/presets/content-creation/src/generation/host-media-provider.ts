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
	ContentGenerationRequest,
	ContentModelDescriptor,
	ContentProviderAdapter,
	GeneratedContent,
} from "./types";

const HOST_MEDIA_PROVIDER_ID = "host-media";
const HOST_MEDIA_JOB_TIMEOUT_MS = 30 * 60 * 1000;
const HOST_MEDIA_POLL_INTERVAL_MS = 1000;

const TEXT_TO_IMAGE_MODE: ContentGenerationMode = {
	id: "text-to-image",
	inputs: [],
};
const IMAGE_TO_IMAGE_MODE: ContentGenerationMode = {
	id: "image-to-image",
	inputs: [{ id: "referenceImages", accepts: ["image"], minItems: 1, maxItems: 1 }],
};
const TEXT_TO_VIDEO_MODE: ContentGenerationMode = { id: "text-to-video", inputs: [] };
const IMAGE_TO_VIDEO_MODE: ContentGenerationMode = {
	id: "image-to-video",
	inputs: [{ id: "referenceImages", accepts: ["image"], minItems: 1, maxItems: 1 }],
};
const VIDEO_TO_VIDEO_MODE: ContentGenerationMode = {
	id: "video-to-video",
	inputs: [{ id: "referenceVideo", accepts: ["video"], minItems: 1, maxItems: 1 }],
};
const REFERENCE_TO_VIDEO_MODE: ContentGenerationMode = {
	id: "reference-to-video",
	inputs: [{ id: "referenceImages", accepts: ["image"], minItems: 1, maxItems: 8 }],
};

interface HostMediaModelBinding {
	provider: PluginMediaProviderDescriptor;
	outputKind: "image" | "video";
}

export class HostMediaProvider implements ContentProviderAdapter {
	readonly id = HOST_MEDIA_PROVIDER_ID;
	private readonly bindings = new Map<string, HostMediaModelBinding>();
	private readonly models: readonly ContentModelDescriptor[];

	constructor(
		private readonly media: PluginMediaApi,
		providers: readonly PluginMediaProviderDescriptor[],
	) {
		this.models = providers.flatMap((provider) => {
			const models = createModels(provider);
			for (const model of models) {
				this.bindings.set(model.modelId, { provider, outputKind: model.outputKind });
			}
			return models;
		});
	}

	listModels(): readonly ContentModelDescriptor[] {
		return this.models;
	}

	async generate(request: ContentGenerationRequest): Promise<GeneratedContent> {
		const binding = this.bindings.get(request.modelId);
		if (!binding) throw new Error(`host media provider not found: ${request.modelId}`);
		const { provider, outputKind } = binding;

		const references = request.references.map<PluginMediaReference>((reference) => {
			return {
				id: reference.id,
				kind: reference.kind,
				mimeType: reference.mimeType,
				source: reference.source,
			};
		});
		const job = await this.media.createJob({
			providerId: provider.id,
			kind: outputKind,
			mode: request.modeId,
			prompt: request.prompt,
			aspectRatio: request.aspectRatio,
			dimensions: dimensionsFromAspectRatio(request.aspectRatio),
			resolution: request.resolution,
			durationSeconds: request.duration,
			references,
		});
		const completed = await waitForMediaJob(this.media, job);
		const artifact = completed.artifacts?.find((candidate) => candidate.kind === outputKind);
		if (!artifact) {
			throw new PluginMediaError({
				code: "provider-failed",
				message: `host media provider returned no ${outputKind} artifact: ${provider.id}`,
				retryable: true,
			});
		}
		return generatedContentFromArtifact(artifact);
	}
}

function createModels(provider: PluginMediaProviderDescriptor): ContentModelDescriptor[] {
	const outputKinds = provider.capabilities
		.map((capability) => capability.kind)
		.filter((kind, index, all) => all.indexOf(kind) === index);
	return outputKinds.flatMap((outputKind) => {
		const capabilities = provider.capabilities.filter((capability) => capability.kind === outputKind);
		const modes = capabilities
			.flatMap((capability) => capability.modes)
			.filter((mode, index, all) => all.indexOf(mode) === index)
			.map(contentModeFromMediaMode);
		if (modes.length === 0) return [];
		return [{
			providerId: HOST_MEDIA_PROVIDER_ID,
			modelId: outputKinds.length === 1 ? provider.id : `${provider.id}:${outputKind}`,
			displayName: provider.id === "desktop-app:vetta" && outputKind === "image" ? "Vetta Image" : provider.id,
			outputKind,
			modes,
			aspectRatios: unique(capabilities.flatMap((capability) => capability.aspectRatios ?? [])),
			resolutions: unique(capabilities.flatMap((capability) => capability.resolutions ?? [])),
			durations: unique(capabilities.flatMap((capability) => capability.durationsSeconds ?? [])),
		}];
	});
}

function contentModeFromMediaMode(mode: PluginMediaGenerationMode): ContentGenerationMode {
	switch (mode) {
		case "text-to-image":
			return TEXT_TO_IMAGE_MODE;
		case "image-to-image":
			return IMAGE_TO_IMAGE_MODE;
		case "text-to-video":
			return TEXT_TO_VIDEO_MODE;
		case "image-to-video":
			return IMAGE_TO_VIDEO_MODE;
		case "video-to-video":
			return VIDEO_TO_VIDEO_MODE;
		case "reference-to-video":
			return REFERENCE_TO_VIDEO_MODE;
	}
}

function unique<Value>(values: readonly Value[]): Value[] {
	return values.filter((value, index, all) => all.indexOf(value) === index);
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
		kind: artifact.kind,
		source: { type: "host-artifact", artifactId: artifact.id },
		mimeType: artifact.mimeType,
		width: artifact.width,
		height: artifact.height,
		duration: artifact.durationSeconds,
	};
}

function delay(milliseconds: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
