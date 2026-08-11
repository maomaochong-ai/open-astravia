import type {
	PluginJobsApi,
	PluginMediaApi,
	PluginMediaJob,
	PluginMediaProviderDescriptor,
} from "@vetta-org/plugin-sdk";
import { describe, expect, it, vi } from "vitest";
import { HostMediaProvider } from "../src/generation/host-media-provider";

const providerDescriptor: PluginMediaProviderDescriptor = {
	id: "host:media",
	ownerId: "host",
	protocolVersion: 4,
	capabilities: [
		{
			operation: "generate",
			kind: "image",
			modes: ["text-to-image", "image-to-image"],
			aspectRatios: ["1:1"],
		},
		{
			operation: "generate",
			kind: "video",
			modes: ["text-to-video", "image-to-video"],
			aspectRatios: ["16:9"],
			resolutions: ["1080p"],
			durationsSeconds: [4, 8],
			modeCapabilities: [
				{
					mode: "image-to-video",
					inputs: [
						{ role: "firstFrame", kinds: ["image"], minItems: 0, maxItems: 1 },
						{ role: "lastFrame", kinds: ["image"], minItems: 0, maxItems: 1 },
					],
					minTotalItems: 1,
					maxTotalItems: 2,
					aspectRatioPolicy: "input-derived",
					audioGeneration: "always",
				},
			],
		},
	],
};

function createApis() {
	const submit = vi.fn<PluginMediaApi["submit"]>();
	const get = vi.fn<PluginJobsApi["get"]>();
	const cancel = vi.fn<PluginJobsApi["cancel"]>();
	const media: PluginMediaApi = {
		registerProvider: vi.fn(),
		listProviders: vi.fn().mockResolvedValue([providerDescriptor]),
		onProvidersChanged: vi.fn(),
		submit,
	};
	const jobs: PluginJobsApi = { get, cancel, wait: vi.fn() };
	return { media, jobs, submit, get, cancel };
}

function createProvider() {
	const apis = createApis();
	return { ...apis, provider: new HostMediaProvider(apis.media, apis.jobs, [providerDescriptor]) };
}

describe("HostMediaProvider", () => {
	it("exposes distinct image and video models from one host provider", () => {
		const { provider } = createProvider();
		expect(provider.listModels()).toEqual([
			expect.objectContaining({ modelId: "host:media:image", outputKind: "image", aspectRatios: ["1:1"] }),
			expect.objectContaining({
				modelId: "host:media:video",
				outputKind: "video",
				resolutions: ["1080p"],
				durations: [4, 8],
			}),
		]);
		expect(provider.listModels()[1]?.modes.find(({ id }) => id === "image-to-video")).toMatchObject({
			inputs: [
				{ id: "firstFrame", maxItems: 1 },
				{ id: "lastFrame", maxItems: 1 },
			],
			minTotalItems: 1,
			aspectRatioPolicy: "input-derived",
			audioGeneration: "always",
		});
	});

	it("persists the host execution before returning a completed artifact", async () => {
		const { provider, submit } = createProvider();
		submit.mockResolvedValue({
			id: "job-1",
			domain: "media",
			operation: "generate",
			status: "succeeded",
			artifacts: [
				{
					id: "artifact-1",
					kind: "image",
					mimeType: "image/png",
					sizeBytes: 32,
					lifetime: "temporary",
				},
			],
		});
		const onExecution = vi.fn().mockResolvedValue(undefined);

		await expect(
			provider.generate(
				{
					providerId: "host-media",
					modelId: "host:media:image",
					modeId: "text-to-image",
					prompt: "draw",
					references: [],
				},
				{ readReference: vi.fn(), onExecution },
			),
		).resolves.toMatchObject({
			kind: "image",
			source: { type: "host-artifact", artifactId: "artifact-1" },
		});
		expect(onExecution).toHaveBeenCalledWith({ kind: "host-job", jobId: "job-1", outputKind: "image" });
	});

	it("forwards distinct first and last frame roles through the host media contract", async () => {
		const { provider, submit } = createProvider();
		submit.mockResolvedValue({
			id: "job-frames",
			domain: "media",
			operation: "generate",
			status: "succeeded",
			artifacts: [
				{
					id: "artifact-frames",
					kind: "video",
					mimeType: "video/mp4",
					sizeBytes: 64,
					lifetime: "temporary",
				},
			],
		});

		await provider.generate(
			{
				providerId: "host-media",
				modelId: "host:media:video",
				modeId: "image-to-video",
				prompt: "transition between frames",
				references: [
					{
						id: "first",
						slotId: "firstFrame",
						kind: "image",
						mimeType: "image/png",
						source: { type: "plugin-blob", blobId: "first" },
					},
					{
						id: "last",
						slotId: "lastFrame",
						kind: "image",
						mimeType: "image/png",
						source: { type: "plugin-blob", blobId: "last" },
					},
				],
			},
			{ readReference: vi.fn() },
		);

		expect(submit).toHaveBeenCalledWith(
			expect.objectContaining({
				mode: "image-to-video",
				inputs: [
					expect.objectContaining({ id: "first", role: "firstFrame" }),
					expect.objectContaining({ id: "last", role: "lastFrame" }),
				],
			}),
		);
	});

	it("resumes a persisted queued job and reports progress", async () => {
		vi.useFakeTimers();
		try {
			const { provider, get } = createProvider();
			get
				.mockResolvedValueOnce({
					id: "job-2",
					domain: "media",
					operation: "generate",
					status: "running",
					progress: { value: 0.6 },
					artifacts: [],
				} as PluginMediaJob)
				.mockResolvedValueOnce({
					id: "job-2",
					domain: "media",
					operation: "generate",
					status: "succeeded",
					artifacts: [
					{
						id: "artifact-2",
						kind: "video",
						mimeType: "video/mp4",
						sizeBytes: 64,
						lifetime: "temporary",
					},
					],
				} as PluginMediaJob);
			const onProgress = vi.fn().mockResolvedValue(undefined);
			const result = provider.resume(
				{ kind: "host-job", jobId: "job-2", outputKind: "video" },
				{ readReference: vi.fn(), onProgress },
			);

			await vi.advanceTimersByTimeAsync(2000);
			await expect(result).resolves.toMatchObject({ kind: "video", source: { artifactId: "artifact-2" } });
			expect(get).toHaveBeenCalledWith("job-2");
			expect(onProgress).toHaveBeenCalledWith({ status: "running", progress: 0.6 });
		} finally {
			vi.useRealTimers();
		}
	});

	it("preserves structured host failures", async () => {
		vi.useFakeTimers();
		try {
			const { provider, get } = createProvider();
			get.mockResolvedValue({
				id: "job-3",
				domain: "media",
				operation: "generate",
				status: "failed",
				artifacts: [],
				error: { code: "quota-exhausted", message: "quota exhausted", retryable: false },
			});
			const result = provider.resume(
				{ kind: "host-job", jobId: "job-3", outputKind: "image" },
				{ readReference: vi.fn() },
			);
			const rejection = expect(result).rejects.toMatchObject({
				code: "quota-exhausted",
				message: "quota exhausted",
			});
			await vi.advanceTimersByTimeAsync(1000);
			await rejection;
		} finally {
			vi.useRealTimers();
		}
	});

	it("fails recovery immediately when the host job no longer exists", async () => {
		vi.useFakeTimers();
		try {
			const { provider, get } = createProvider();
			get.mockResolvedValue({
				id: "missing-job",
				domain: "job",
				operation: "get",
				status: "failed",
				artifacts: [],
				error: { code: "job-not-found", message: "Job is unavailable: missing-job", retryable: false },
			});
			const result = provider.resume(
				{ kind: "host-job", jobId: "missing-job", outputKind: "image" },
				{ readReference: vi.fn() },
			);
			const rejection = expect(result).rejects.toMatchObject({
				code: "provider-failed",
				message: "host media job is no longer available: missing-job",
				retryable: true,
			});
			await vi.advanceTimersByTimeAsync(1000);
			await rejection;
			expect(get).toHaveBeenCalledTimes(1);
		} finally {
			vi.useRealTimers();
		}
	});

	it("does not cancel the host job when the renderer runtime is disposed", async () => {
		vi.useFakeTimers();
		try {
			const { provider, cancel } = createProvider();
			const controller = new AbortController();
			const result = provider.resume(
				{ kind: "host-job", jobId: "job-4", outputKind: "video" },
				{ readReference: vi.fn(), signal: controller.signal },
			);
			controller.abort(new DOMException("reload", "AbortError"));
			await expect(result).rejects.toMatchObject({ name: "AbortError" });
			expect(cancel).not.toHaveBeenCalled();
		} finally {
			vi.useRealTimers();
		}
	});
});
