import { randomUUID } from "node:crypto";
import type {
	Disposable,
	MediaCreateJobInput,
	MediaFailure,
	MediaGenerationMode,
	MediaJob,
	MediaJobRef,
	MediaKind,
	MediaProviderCreateJobInput,
	MediaProviderDescriptor,
	MediaProviderJob,
} from "@vetta/capability-sdk";

const MODE_KIND: Record<MediaGenerationMode, MediaKind> = {
	"text-to-image": "image",
	"image-to-image": "image",
	"text-to-video": "video",
	"image-to-video": "video",
	"video-to-video": "video",
	"reference-to-video": "video",
};

const TERMINAL_STATUSES = new Set<MediaProviderJob["status"]>(["succeeded", "failed", "cancelled"]);

export interface MediaProviderCallContext {
	readonly signal: AbortSignal;
}

export interface MediaProviderRegistration {
	readonly descriptor: MediaProviderDescriptor;
	createJob(input: MediaProviderCreateJobInput, context: MediaProviderCallContext): Promise<MediaProviderJob>;
	getJob?(jobId: string, context: MediaProviderCallContext): Promise<MediaProviderJob>;
	cancelJob?(jobId: string, context: MediaProviderCallContext): Promise<MediaProviderJob>;
}

interface RegisteredProvider {
	readonly registration: MediaProviderRegistration;
	readonly calls: Set<AbortController>;
}

function failed(providerId: string, id: string, error: MediaFailure): MediaJob {
	return { providerId, id, status: "failed", error };
}

function failure(code: MediaFailure["code"], message: string, retryable = false): MediaFailure {
	return { code, message, retryable };
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
		capabilities: descriptor.capabilities.map((capability) => ({
			...capability,
			modes: [...capability.modes],
			aspectRatios: capability.aspectRatios ? [...capability.aspectRatios] : undefined,
			resolutions: capability.resolutions ? [...capability.resolutions] : undefined,
			durationsSeconds: capability.durationsSeconds ? [...capability.durationsSeconds] : undefined,
		})),
	};
}

function normalizeJob(providerId: string, job: MediaProviderJob): MediaJob {
	const artifacts = job.artifacts ?? [];
	if (job.status === "succeeded" && artifacts.length === 0) {
		return failed(providerId, job.id, failure("provider-failed", "Media provider returned no artifacts"));
	}
	if (job.status === "failed" && !job.error) {
		return failed(providerId, job.id, failure("provider-failed", "Media provider returned no failure details"));
	}
	return { ...job, providerId, artifacts };
}

export class MediaProviderRegistry {
	private readonly providers = new Map<string, RegisteredProvider>();

	registerProvider(registration: MediaProviderRegistration): Disposable {
		const { descriptor } = registration;
		if (this.providers.has(descriptor.id)) throw new Error(`Media provider already registered: ${descriptor.id}`);
		if (descriptor.capabilities.length === 0) throw new Error("Media provider must declare capabilities");
		for (const capability of descriptor.capabilities) {
			if (capability.modes.length === 0 || capability.modes.some((mode) => MODE_KIND[mode] !== capability.kind)) {
				throw new Error(`Media provider capability is invalid: ${descriptor.id}`);
			}
		}
		const provider: RegisteredProvider = { registration, calls: new Set() };
		this.providers.set(descriptor.id, provider);
		let disposed = false;
		return {
			dispose: () => {
				if (disposed) return;
				disposed = true;
				if (this.providers.get(descriptor.id) !== provider) return;
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

	async createJob(input: MediaCreateJobInput, signal: AbortSignal): Promise<MediaJob> {
		const provider = this.providers.get(input.providerId);
		if (!provider) {
			return failed(
				input.providerId,
				randomUUID(),
				failure("provider-unavailable", `Media provider is unavailable: ${input.providerId}`),
			);
		}
		if (MODE_KIND[input.mode] !== input.kind) {
			return failed(
				input.providerId,
				randomUUID(),
				failure("invalid-request", `${input.mode} cannot produce ${input.kind}`),
			);
		}
		const supported = provider.registration.descriptor.capabilities.some(
			(capability) => capability.kind === input.kind && capability.modes.includes(input.mode),
		);
		if (!supported) {
			return failed(
				input.providerId,
				randomUUID(),
				failure("operation-unsupported", `Media provider does not support ${input.mode}`),
			);
		}
		const { providerId, references = [], ...providerInput } = input;
		const job = await this.invoke(provider, signal, (context) =>
			provider.registration.createJob({ ...providerInput, references }, context),
		);
		if ("code" in job) return failed(providerId, randomUUID(), job);
		if (!TERMINAL_STATUSES.has(job.status) && !provider.registration.getJob) {
			return failed(
				providerId,
				job.id,
				failure("provider-failed", "Asynchronous provider does not implement getJob"),
			);
		}
		return normalizeJob(providerId, job);
	}

	getJob(input: MediaJobRef, signal: AbortSignal): Promise<MediaJob> {
		return this.invokeJobOperation(input, signal, "getJob");
	}

	cancelJob(input: MediaJobRef, signal: AbortSignal): Promise<MediaJob> {
		return this.invokeJobOperation(input, signal, "cancelJob");
	}

	private async invokeJobOperation(
		input: MediaJobRef,
		signal: AbortSignal,
		operation: "getJob" | "cancelJob",
	): Promise<MediaJob> {
		const provider = this.providers.get(input.providerId);
		if (!provider) {
			return failed(input.providerId, input.id, failure("provider-unavailable", "Media provider is unavailable"));
		}
		const handler = provider.registration[operation];
		if (!handler) {
			return failed(input.providerId, input.id, failure("operation-unsupported", `${operation} is unsupported`));
		}
		const job = await this.invoke(provider, signal, (context) => handler(input.id, context));
		return "code" in job ? failed(input.providerId, input.id, job) : normalizeJob(input.providerId, job);
	}

	private async invoke(
		provider: RegisteredProvider,
		signal: AbortSignal,
		call: (context: MediaProviderCallContext) => Promise<MediaProviderJob>,
	): Promise<MediaProviderJob | MediaFailure> {
		const controller = new AbortController();
		const unlink = linkAbortSignal(controller, signal);
		provider.calls.add(controller);
		try {
			if (controller.signal.aborted) return failure("cancelled", "Media generation was cancelled");
			const job = await call({ signal: controller.signal });
			if (controller.signal.aborted) return failure("cancelled", "Media generation was cancelled");
			return job;
		} catch (error) {
			if (controller.signal.aborted) return failure("cancelled", "Media generation was cancelled");
			return failure("provider-failed", error instanceof Error ? error.message : "Media provider failed", true);
		} finally {
			unlink();
			provider.calls.delete(controller);
		}
	}
}
