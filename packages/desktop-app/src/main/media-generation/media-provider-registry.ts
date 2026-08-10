import type {
	Disposable,
	Job,
	MediaFailure,
	MediaGenerateInput,
	MediaGenerationMode,
	MediaInput,
	MediaKind,
	MediaProviderDescriptor,
	MediaProviderJob,
	MediaSubmitInput,
} from "@vetta/capability-sdk";
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

function cloneDescriptor(descriptor: MediaProviderDescriptor): MediaProviderDescriptor {
	return {
		...descriptor,
		capabilities: descriptor.capabilities.map((capability) => {
			if (capability.operation === "generate") {
				return {
					...capability,
					modes: [...capability.modes],
					modeCapabilities: capability.modeCapabilities?.map((mode) => ({
						...mode,
						inputs: mode.inputs.map((input) => ({ ...input, kinds: [...input.kinds] })),
					})),
					aspectRatios: capability.aspectRatios ? [...capability.aspectRatios] : undefined,
					resolutions: capability.resolutions ? [...capability.resolutions] : undefined,
					durationsSeconds: capability.durationsSeconds ? [...capability.durationsSeconds] : undefined,
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
		}),
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

function validateGenerate(input: MediaGenerateInput, descriptor: MediaProviderDescriptor): MediaFailure | undefined {
	if (MODE_KIND[input.mode] !== input.kind) {
		return failure("invalid-request", `${input.mode} cannot produce ${input.kind}`);
	}
	const supported = descriptor.capabilities.some(
		(capability) =>
			capability.operation === "generate" && capability.kind === input.kind && capability.modes.includes(input.mode),
	);
	return supported ? undefined : failure("operation-unsupported", `Media provider does not support ${input.mode}`);
}

function validateInputs(input: MediaSubmitInput, descriptor: MediaProviderDescriptor): MediaFailure | undefined {
	if (input.operation === "generate") return validateGenerate(input, descriptor);
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

	constructor(private readonly jobs: JobManager) {}

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
		if (!provider) {
			return this.createFailedJob(
				input,
				failure("provider-unavailable", `Media provider is unavailable: ${input.providerId}`),
			);
		}
		const validationFailure = validateInputs(input, provider.registration.descriptor);
		if (validationFailure) return this.createFailedJob(input, validationFailure);

		const { ownerId, providerId, ...providerInput } = input;
		const providerJob = await this.invoke(provider, ownerId, signal, (context) =>
			provider.registration.submit(providerInput as MediaHostProviderSubmitInput, context),
		);
		if ("code" in providerJob) return this.createFailedJob(input, providerJob);
		let initial = normalizeProviderJob(providerJob);
		if (!TERMINAL_STATUSES.has(providerJob.status) && !provider.registration.getJob) {
			initial = failedUpdate(failure("provider-failed", "Asynchronous provider does not implement getJob"));
		}
		return this.jobs.create({
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
							return "code" in refreshed ? failedUpdate(refreshed) : normalizeProviderJob(refreshed);
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
							return "code" in cancelled ? failedUpdate(cancelled) : normalizeProviderJob(cancelled);
						}
					: undefined,
			},
		});
	}

	private createFailedJob(input: MediaSubmitInput, error: MediaFailure): Job {
		return this.jobs.create({
			ownerId: input.ownerId,
			domain: "media",
			operation: input.operation,
			metadata: { providerId: input.providerId },
			...failedUpdate(error),
		});
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
