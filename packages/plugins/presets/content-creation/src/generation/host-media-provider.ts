import {
	PluginMediaError,
	type PluginJob,
	type PluginJobsApi,
	type PluginMediaApi,
	type PluginMediaArtifact,
	type PluginMediaGenerationMode,
	type PluginMediaProviderDescriptor,
	type PluginMediaInput,
} from "@vetta-org/plugin-sdk";
import type {
	ContentGenerationMode,
	ContentGenerationRequest,
	ContentModelDescriptor,
	ContentProviderAdapter,
	ContentProviderExecution,
	ContentProviderGenerationContext,
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
		private readonly jobs: PluginJobsApi,
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

	async generate(
		request: ContentGenerationRequest,
		context: ContentProviderGenerationContext,
	): Promise<GeneratedContent> {
		const binding = this.bindings.get(request.modelId);
		if (!binding) throw new Error(`host media provider not found: ${request.modelId}`);
		const { provider, outputKind } = binding;

		const inputs = request.references.map<PluginMediaInput>((reference) => {
			return {
				id: reference.id,
				kind: reference.kind,
				mimeType: reference.mimeType,
				source: reference.source,
			};
		});
		const job = await this.media.submit({
			operation: "generate",
			providerId: provider.id,
			kind: outputKind,
			mode: request.modeId,
			prompt: request.prompt,
			aspectRatio: request.aspectRatio,
			dimensions: dimensionsFromAspectRatio(request.aspectRatio),
			resolution: request.resolution,
			durationSeconds: request.duration,
			inputs,
		});
		const execution: ContentProviderExecution = { kind: "host-job", jobId: job.id, outputKind };
		await context.onExecution?.(execution);
		return this.waitForJob(execution, context, job);
	}

	async resume(
		execution: ContentProviderExecution,
		context: ContentProviderGenerationContext,
	): Promise<GeneratedContent> {
		return this.waitForJob(execution, context);
	}

	private async waitForJob(
		execution: ContentProviderExecution,
		context: ContentProviderGenerationContext,
		initial?: PluginJob,
	): Promise<GeneratedContent> {
		const timeoutSignal = AbortSignal.timeout(HOST_MEDIA_JOB_TIMEOUT_MS);
		const signal = context.signal ? AbortSignal.any([context.signal, timeoutSignal]) : timeoutSignal;
		let completed = initial;
		try {
			while (!completed || !isTerminalJob(completed)) {
				if (completed) await notifyProgress(context, completed);
				await waitForPoll(HOST_MEDIA_POLL_INTERVAL_MS, signal);
				try {
					completed = await this.jobs.get(execution.jobId);
				} catch (error) {
					if (signal.aborted) throw error;
					// Provider plugins are briefly unavailable while the renderer reloads.
					// Keep the host job active and retry against the replacement registration.
				}
			}
		} catch (error) {
			if (context.signal?.aborted) throw abortError(context.signal);
			await this.jobs.cancel(execution.jobId).catch(() => undefined);
			throw new PluginMediaError({
				code: "provider-timeout",
				message: `host media job timed out: ${execution.jobId}`,
				retryable: true,
			});
		}
		await notifyProgress(context, completed);
		if (completed.status === "failed") {
			if (completed.error?.code === "job-not-found") {
				throw new PluginMediaError({
					code: "provider-failed",
					message: `host media job is no longer available: ${execution.jobId}`,
					retryable: true,
				});
			}
			throw new PluginMediaError(
				completed.error ?? {
					code: "provider-failed",
					message: `host media job failed: ${execution.jobId}`,
					retryable: true,
				},
			);
		}
		if (completed.status === "cancelled") {
			throw new PluginMediaError({
				code: "cancelled",
				message: `host media job was cancelled: ${execution.jobId}`,
				retryable: true,
			});
		}
		const artifact = completed.artifacts.find((candidate) => candidate.kind === execution.outputKind);
		if (!artifact) {
			throw new PluginMediaError({
				code: "provider-failed",
				message: `host media provider returned no ${execution.outputKind} artifact: ${execution.jobId}`,
				retryable: true,
			});
		}
		return generatedContentFromArtifact(artifact);
	}
}

function isTerminalJob(job: PluginJob): boolean {
	return job.status === "succeeded" || job.status === "failed" || job.status === "cancelled";
}

async function notifyProgress(context: ContentProviderGenerationContext, job: PluginJob): Promise<void> {
	if (job.status !== "queued" && job.status !== "running") return;
	await context.onProgress?.({ status: job.status, progress: job.progress?.value });
}

function abortError(signal: AbortSignal): Error {
	return signal.reason instanceof Error ? signal.reason : new DOMException("The operation was aborted", "AbortError");
}

function waitForPoll(ms: number, signal: AbortSignal): Promise<void> {
	if (signal.aborted) return Promise.reject(abortError(signal));
	return new Promise((resolve, reject) => {
		const timeout = setTimeout(() => {
			signal.removeEventListener("abort", onAbort);
			resolve();
		}, ms);
		const onAbort = (): void => {
			clearTimeout(timeout);
			reject(abortError(signal));
		};
		signal.addEventListener("abort", onAbort, { once: true });
	});
}

function createModels(provider: PluginMediaProviderDescriptor): ContentModelDescriptor[] {
	const generationCapabilities = provider.capabilities.filter(
		(capability) => capability.operation === "generate",
	);
	const outputKinds = generationCapabilities
		.map((capability) => capability.kind)
		.filter((kind, index, all) => all.indexOf(kind) === index);
	return outputKinds.flatMap((outputKind) => {
		const capabilities = generationCapabilities.filter((capability) => capability.kind === outputKind);
		const modes = capabilities
			.flatMap((capability) => capability.modes)
			.filter((mode, index, all) => all.indexOf(mode) === index)
			.map(contentModeFromMediaMode);
		if (modes.length === 0) return [];
		return [{
			providerId: HOST_MEDIA_PROVIDER_ID,
			modelId: outputKinds.length === 1 ? provider.id : `${provider.id}:${outputKind}`,
			displayName:
				provider.displayName ??
				(provider.id === "desktop-app:vetta" && outputKind === "image" ? "Vetta Image" : provider.id),
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
