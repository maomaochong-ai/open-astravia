import { randomUUID } from "node:crypto";
import type {
	Disposable,
	Job,
	MediaFailure,
	MediaGenerateInput,
	MediaGenerationMode,
	MediaInput,
	MediaKind,
	MediaProviderCapability,
	MediaProviderDescriptor,
	MediaProviderJob,
	MediaSubmitInput,
} from "@vetta-org/capability-sdk";
import type { JobManager, ManagedJobUpdate } from "../jobs/job-manager.js";

const MODE_KIND: Record<MediaGenerationMode, MediaKind> = {
	"text-to-image": "image",
	"image-to-image": "image",
	"text-to-video": "video",
	"image-to-video": "video",
	"video-to-video": "video",
	"reference-to-video": "video",
};

const TERMINAL_STATUSES = new Set<MediaProviderJob["status"]>(["succeeded", "failed", "cancelled"]);

export interface MediaProviderRegistryLogger {
	info(message: string, fields: Record<string, unknown>): void;
	warn(message: string, fields: Record<string, unknown>): void;
}

const NOOP_LOGGER: MediaProviderRegistryLogger = {
	info: () => undefined,
	warn: () => undefined,
};

interface MediaJobLogContext {
	readonly attemptId: string;
	readonly startedAt: number;
	readonly fields: Record<string, unknown>;
	jobId?: string;
	providerJobId?: string;
	lastStateKey?: string;
}

type ToHostProviderInput<Input> = Input extends MediaSubmitInput
	? Omit<Input, "ownerId" | "providerId"> & { readonly inputs: readonly MediaInput[] }
	: never;
export type MediaHostProviderSubmitInput = ToHostProviderInput<MediaSubmitInput>;

export interface MediaProviderCallContext {
	readonly ownerId: string;
	readonly signal: AbortSignal;
}

export interface MediaProviderRegistration {
	readonly descriptor: MediaProviderDescriptor;
	submit(input: MediaHostProviderSubmitInput, context: MediaProviderCallContext): Promise<MediaProviderJob>;
	getJob?(jobId: string, context: MediaProviderCallContext): Promise<MediaProviderJob>;
	cancelJob?(jobId: string, context: MediaProviderCallContext): Promise<MediaProviderJob>;
}

interface RegisteredProvider {
	readonly registration: MediaProviderRegistration;
	readonly calls: Set<AbortController>;
	active: boolean;
}

type DeepReadonly<Value> = Value extends readonly (infer Item)[]
	? readonly DeepReadonly<Item>[]
	: Value extends object
		? { readonly [Key in keyof Value]: DeepReadonly<Value[Key]> }
		: Value;

type MediaProviderCapabilityInput = DeepReadonly<MediaProviderCapability>;

function failure(code: MediaFailure["code"], message: string, retryable = false): MediaFailure {
	return { code, message, retryable };
}

function failedUpdate(error: MediaFailure): ManagedJobUpdate {
	return { status: "failed", artifacts: [], error };
}

function linkAbortSignal(controller: AbortController, signal: AbortSignal): () => void {
	const abort = (): void => controller.abort(signal.reason);
	if (signal.aborted) abort();
	else signal.addEventListener("abort", abort, { once: true });
	return () => signal.removeEventListener("abort", abort);
}

export function cloneMediaProviderCapabilities(
	capabilities: readonly MediaProviderCapabilityInput[],
): MediaProviderDescriptor["capabilities"] {
	return capabilities.map((capability) => {
		if (capability.operation === "generate") {
			const {
				aspectRatios,
				defaultModelId,
				defaultResolution,
				durationsSeconds,
				modeCapabilities,
				models,
				resolutions,
				...required
			} = capability;
			return {
				...required,
				modes: [...capability.modes],
				...(modeCapabilities
					? {
							modeCapabilities: modeCapabilities.map((mode) => {
								const { aspectRatioPolicy, audioGeneration, maxTotalItems, minTotalItems, ...modeRequired } =
									mode;
								return {
									...modeRequired,
									inputs: mode.inputs.map((input) => ({ ...input, kinds: [...input.kinds] })),
									...(minTotalItems !== undefined ? { minTotalItems } : {}),
									...(maxTotalItems !== undefined ? { maxTotalItems } : {}),
									...(aspectRatioPolicy !== undefined ? { aspectRatioPolicy } : {}),
									...(audioGeneration !== undefined ? { audioGeneration } : {}),
								};
							}),
						}
					: {}),
				...(aspectRatios !== undefined ? { aspectRatios: [...aspectRatios] } : {}),
				...(resolutions !== undefined ? { resolutions: [...resolutions] } : {}),
				...(defaultResolution !== undefined ? { defaultResolution } : {}),
				...(models !== undefined
					? {
							models: models.map((model) => {
								const {
									aspectRatios: modelAspectRatios,
									modes,
									resolutions: modelResolutions,
									...modelRequired
								} = model;
								return {
									...modelRequired,
									modes: [...modes],
									...(modelAspectRatios ? { aspectRatios: [...modelAspectRatios] } : {}),
									...(modelResolutions ? { resolutions: [...modelResolutions] } : {}),
								};
							}),
						}
					: {}),
				...(defaultModelId !== undefined ? { defaultModelId } : {}),
				...(durationsSeconds !== undefined ? { durationsSeconds: [...durationsSeconds] } : {}),
			};
		}
		if (capability.operation === "compose") {
			return {
				...capability,
				documentMimeTypes: [...capability.documentMimeTypes],
				outputMimeTypes: [...capability.outputMimeTypes],
			};
		}
		return {
			...capability,
			inputMimeTypes: [...capability.inputMimeTypes],
			outputMimeTypes: [...capability.outputMimeTypes],
		};
	});
}

function cloneDescriptor(descriptor: MediaProviderDescriptor): MediaProviderDescriptor {
	const { displayName, ...required } = descriptor;
	return {
		...required,
		...(displayName !== undefined ? { displayName } : {}),
		capabilities: cloneMediaProviderCapabilities(descriptor.capabilities),
	};
}

function normalizeProviderJob(job: MediaProviderJob): ManagedJobUpdate {
	const artifacts = job.artifacts ?? [];
	if (job.status === "succeeded" && artifacts.length === 0) {
		return failedUpdate(failure("provider-failed", "Media provider returned no artifacts"));
	}
	if (job.status === "failed" && !job.error) {
		return failedUpdate(failure("provider-failed", "Media provider returned no failure details"));
	}
	return {
		status: job.status,
		artifacts,
		...(job.progress === undefined ? {} : { progress: { value: job.progress } }),
		...(job.error ? { error: job.error } : {}),
	};
}

function includesString(values: readonly string[], value: string): boolean {
	return values.includes(value);
}

function resolveGenerate(
	input: MediaGenerateInput,
	descriptor: MediaProviderDescriptor,
): { input: MediaGenerateInput } | { error: MediaFailure } {
	if (MODE_KIND[input.mode] !== input.kind) {
		return { error: failure("invalid-request", `${input.mode} cannot produce ${input.kind}`) };
	}
	const capabilities = descriptor.capabilities.filter(
		(capability): capability is Extract<MediaProviderCapability, { operation: "generate" }> =>
			capability.operation === "generate" && capability.kind === input.kind && capability.modes.includes(input.mode),
	);
	if (capabilities.length === 0) {
		return { error: failure("operation-unsupported", `Media provider does not support ${input.mode}`) };
	}
	if (input.modelId) {
		const supported = capabilities.some(
			(capability) =>
				!capability.models ||
				capability.models.some((model) => model.id === input.modelId && model.modes.includes(input.mode)),
		);
		return supported
			? { input }
			: {
					error: failure(
						"invalid-request",
						`Media model is unavailable or does not support ${input.mode}: ${input.modelId}`,
					),
				};
	}
	const defaultModelId = capabilities
		.map((capability) => {
			const preferred = capability.models?.find(
				(model) => model.id === capability.defaultModelId && model.modes.includes(input.mode),
			);
			return preferred?.id ?? capability.models?.find((model) => model.modes.includes(input.mode))?.id;
		})
		.find((modelId): modelId is string => modelId !== undefined);
	return { input: defaultModelId ? { ...input, modelId: defaultModelId } : input };
}

function validateInputs(input: MediaSubmitInput, descriptor: MediaProviderDescriptor): MediaFailure | undefined {
	if (input.operation === "generate") return undefined;
	if (input.operation === "compose") {
		const document = input.inputs.find((candidate) => candidate.kind === "document");
		if (!document?.mimeType) return failure("invalid-request", "Media composition requires a typed document input");
		const documentMimeType = document.mimeType;
		const supported = descriptor.capabilities.some(
			(capability) =>
				capability.operation === "compose" &&
				includesString(capability.documentMimeTypes, documentMimeType) &&
				includesString(capability.outputMimeTypes, input.output.mimeType),
		);
		return supported
			? undefined
			: failure("operation-unsupported", "Media provider does not support this composition format");
	}
	const source = input.inputs.length === 1 ? input.inputs[0] : undefined;
	if (!source?.mimeType) return failure("invalid-request", "Media transcode requires exactly one typed input");
	const sourceMimeType = source.mimeType;
	const supported = descriptor.capabilities.some(
		(capability) =>
			capability.operation === "transcode" &&
			includesString(capability.inputMimeTypes, sourceMimeType) &&
			includesString(capability.outputMimeTypes, input.output.mimeType),
	);
	return supported ? undefined : failure("operation-unsupported", "Media provider does not support this transcode");
}

export class MediaProviderRegistry {
	private readonly providers = new Map<string, RegisteredProvider>();

	constructor(
		private readonly jobs: JobManager,
		private readonly logger: MediaProviderRegistryLogger = NOOP_LOGGER,
	) {}

	registerProvider(registration: MediaProviderRegistration): Disposable {
		const { descriptor } = registration;
		if (this.providers.has(descriptor.id)) throw new Error(`Media provider already registered: ${descriptor.id}`);
		if (descriptor.capabilities.length === 0) throw new Error("Media provider must declare capabilities");
		for (const capability of descriptor.capabilities) {
			if (
				capability.operation === "generate" &&
				(capability.modes.length === 0 || capability.modes.some((mode) => MODE_KIND[mode] !== capability.kind))
			) {
				throw new Error(`Media provider capability is invalid: ${descriptor.id}`);
			}
			if (
				capability.operation === "generate" &&
				capability.defaultResolution !== undefined &&
				!capability.resolutions?.includes(capability.defaultResolution)
			) {
				throw new Error(`Media provider default resolution is not declared: ${descriptor.id}`);
			}
			if (capability.operation === "generate" && capability.models) {
				const ids = new Set<string>();
				for (const model of capability.models) {
					if (ids.has(model.id))
						throw new Error(`Media provider model id is duplicated: ${descriptor.id}/${model.id}`);
					ids.add(model.id);
					if (
						model.modes.some((mode) => !capability.modes.includes(mode) || MODE_KIND[mode] !== capability.kind)
					) {
						throw new Error(`Media provider model modes are invalid: ${descriptor.id}/${model.id}`);
					}
					if (model.defaultResolution && !model.resolutions?.includes(model.defaultResolution)) {
						throw new Error(
							`Media provider model default resolution is not declared: ${descriptor.id}/${model.id}`,
						);
					}
				}
				if (capability.defaultModelId && !ids.has(capability.defaultModelId)) {
					throw new Error(`Media provider default model is not declared: ${descriptor.id}`);
				}
			} else if (capability.operation === "generate" && capability.defaultModelId) {
				throw new Error(`Media provider default model requires a model catalog: ${descriptor.id}`);
			}
		}
		const provider: RegisteredProvider = { registration, calls: new Set(), active: true };
		this.providers.set(descriptor.id, provider);
		let disposed = false;
		return {
			dispose: () => {
				if (disposed) return;
				disposed = true;
				if (this.providers.get(descriptor.id) !== provider) return;
				provider.active = false;
				this.providers.delete(descriptor.id);
				for (const controller of provider.calls) controller.abort("Media provider was unloaded");
				provider.calls.clear();
			},
		};
	}

	listProviders(): MediaProviderDescriptor[] {
		return Array.from(this.providers.values(), ({ registration }) => cloneDescriptor(registration.descriptor)).sort(
			(left, right) => left.id.localeCompare(right.id),
		);
	}

	async submit(input: MediaSubmitInput, signal: AbortSignal): Promise<Job> {
		const provider = this.providers.get(input.providerId);
		const logContext = this.createLogContext(input, provider?.registration.descriptor);
		this.logger.info("media job submitted", logContext.fields);
		if (!provider) {
			return this.createFailedJob(
				input,
				failure("provider-unavailable", `Media provider is unavailable: ${input.providerId}`),
				logContext,
			);
		}
		let resolvedInput: MediaSubmitInput = input;
		if (input.operation === "generate") {
			const result = resolveGenerate(input, provider.registration.descriptor);
			if ("error" in result) return this.createFailedJob(input, result.error, logContext);
			resolvedInput = result.input;
		}
		const validationFailure = validateInputs(resolvedInput, provider.registration.descriptor);
		if (validationFailure) return this.createFailedJob(input, validationFailure, logContext);

		const { ownerId, providerId, ...providerInput } = resolvedInput;
		const providerJob = await this.invoke(provider, ownerId, signal, (context) =>
			provider.registration.submit(providerInput as MediaHostProviderSubmitInput, context),
		);
		if ("code" in providerJob) return this.createFailedJob(input, providerJob, logContext);
		logContext.providerJobId = providerJob.id;
		let initial = normalizeProviderJob(providerJob);
		if (!TERMINAL_STATUSES.has(providerJob.status) && !provider.registration.getJob) {
			initial = failedUpdate(failure("provider-failed", "Asynchronous provider does not implement getJob"));
		}
		const job = this.jobs.create({
			ownerId,
			domain: "media",
			operation: input.operation,
			metadata: { providerId },
			...initial,
			driver: {
				refresh: provider.registration.getJob
					? async (refreshSignal) => {
							const currentProvider = this.providers.get(providerId);
							if (!currentProvider?.registration.getJob) {
								throw new Error(`Media provider is temporarily unavailable: ${providerId}`);
							}
							const refreshed = await this.invoke(currentProvider, ownerId, refreshSignal, (context) =>
								currentProvider.registration.getJob!(providerJob.id, context),
							);
							const update = "code" in refreshed ? failedUpdate(refreshed) : normalizeProviderJob(refreshed);
							this.logJobState(logContext, update);
							return update;
						}
					: undefined,
				cancel: provider.registration.cancelJob
					? async (cancelSignal) => {
							const currentProvider = this.providers.get(providerId);
							if (!currentProvider?.registration.cancelJob) {
								throw new Error(`Media provider is unavailable or cannot cancel jobs: ${providerId}`);
							}
							const cancelled = await this.invoke(currentProvider, ownerId, cancelSignal, (context) =>
								currentProvider.registration.cancelJob!(providerJob.id, context),
							);
							const update = "code" in cancelled ? failedUpdate(cancelled) : normalizeProviderJob(cancelled);
							this.logJobState(logContext, update);
							return update;
						}
					: undefined,
			},
		});
		logContext.jobId = job.id;
		this.logJobState(logContext, initial);
		return job;
	}

	private createFailedJob(input: MediaSubmitInput, error: MediaFailure, logContext: MediaJobLogContext): Job {
		const job = this.jobs.create({
			ownerId: input.ownerId,
			domain: "media",
			operation: input.operation,
			metadata: { providerId: input.providerId },
			...failedUpdate(error),
		});
		logContext.jobId = job.id;
		this.logJobState(logContext, failedUpdate(error));
		return job;
	}

	private createLogContext(
		input: MediaSubmitInput,
		descriptor: MediaProviderDescriptor | undefined,
	): MediaJobLogContext {
		const attemptId = randomUUID();
		return {
			attemptId,
			startedAt: Date.now(),
			fields: {
				attemptId,
				consumerId: input.ownerId,
				providerId: input.providerId,
				...(descriptor?.ownerId ? { providerOwnerId: descriptor.ownerId } : {}),
				...(descriptor?.displayName ? { providerDisplayName: descriptor.displayName } : {}),
				operation: input.operation,
				inputCount: input.inputs.length,
				...(input.operation === "generate"
					? {
							mediaKind: input.kind,
							generationMode: input.mode,
							...(input.modelId ? { modelId: input.modelId } : {}),
							...(input.dimensions
								? { requestedWidth: input.dimensions.width, requestedHeight: input.dimensions.height }
								: {}),
							...(input.aspectRatio ? { aspectRatio: input.aspectRatio } : {}),
							...(input.resolution ? { resolution: input.resolution } : {}),
							...(input.durationSeconds !== undefined ? { durationSeconds: input.durationSeconds } : {}),
						}
					: { outputKind: input.output.kind, outputMimeType: input.output.mimeType }),
			},
		};
	}

	private logJobState(logContext: MediaJobLogContext, update: ManagedJobUpdate): void {
		const stateKey = [
			update.status,
			update.progress?.value ?? "",
			update.artifacts?.length ?? 0,
			update.error?.code ?? "",
		].join(":");
		if (stateKey === logContext.lastStateKey) return;
		logContext.lastStateKey = stateKey;
		const fields = {
			...logContext.fields,
			...(logContext.jobId ? { jobId: logContext.jobId } : {}),
			...(logContext.providerJobId ? { providerJobId: logContext.providerJobId } : {}),
			status: update.status,
			...(update.progress ? { progress: update.progress.value } : {}),
			artifactCount: update.artifacts?.length ?? 0,
			...(TERMINAL_STATUSES.has(update.status) ? { elapsedMs: Date.now() - logContext.startedAt } : {}),
			...(update.error ? { errorCode: update.error.code, retryable: update.error.retryable } : {}),
		};
		if (update.status === "failed") this.logger.warn("media job state", fields);
		else this.logger.info("media job state", fields);
	}

	private async invoke(
		provider: RegisteredProvider,
		ownerId: string,
		signal: AbortSignal,
		call: (context: MediaProviderCallContext) => Promise<MediaProviderJob>,
	): Promise<MediaProviderJob | MediaFailure> {
		const controller = new AbortController();
		const unlink = linkAbortSignal(controller, signal);
		provider.calls.add(controller);
		try {
			if (controller.signal.aborted) return failure("cancelled", "Media job was cancelled");
			const job = await call({ ownerId, signal: controller.signal });
			if (controller.signal.aborted) return failure("cancelled", "Media job was cancelled");
			return job;
		} catch (error) {
			if (controller.signal.aborted) return failure("cancelled", "Media job was cancelled");
			return failure("provider-failed", error instanceof Error ? error.message : "Media provider failed", true);
		} finally {
			unlink();
			provider.calls.delete(controller);
		}
	}
}
