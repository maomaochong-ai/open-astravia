import type { PluginMediaApi, PluginMediaProviderDescriptor } from "@vetta-org/plugin-sdk";
import { describe, expect, it, vi } from "vitest";
import { HostMediaProvider } from "../src/generation/host-media-provider";
import type { ContentProviderAdapter } from "../src/generation/types";

const providerDescriptor: PluginMediaProviderDescriptor = {
	id: "host:media",
	ownerId: "host",
	protocolVersion: 2,
	capabilities: [
		{
			kind: "image",
			modes: ["text-to-image", "image-to-image"],
			aspectRatios: ["1:1"],
		},
		{
			kind: "video",
			modes: ["text-to-video", "image-to-video"],
			aspectRatios: ["16:9"],
			resolutions: ["1080p"],
			durationsSeconds: [4, 8],
		},
	],
};

function createMediaApi() {
	const listProviders = vi.fn<PluginMediaApi["listProviders"]>().mockResolvedValue([providerDescriptor]);
	const createJob = vi.fn<PluginMediaApi["createJob"]>();
	const getJob = vi.fn<PluginMediaApi["getJob"]>();
	const cancelJob = vi.fn<PluginMediaApi["cancelJob"]>();
	const saveArtifact = vi.fn<PluginMediaApi["saveArtifact"]>();
	const releaseArtifact = vi.fn<PluginMediaApi["releaseArtifact"]>();
	const media: PluginMediaApi = {
		registerProvider: vi.fn(),
		listProviders,
		onProvidersChanged: vi.fn(),
		createJob,
		getJob,
		cancelJob,
		saveArtifact,
		releaseArtifact,
	};
	return { media, createJob, getJob, cancelJob };
}

describe("HostMediaProvider", () => {
	it("exposes distinct image and video models from one host provider", () => {
		const { media } = createMediaApi();
		const provider = new HostMediaProvider(media, [providerDescriptor]);

		expect(provider.listModels()).toEqual([
			expect.objectContaining({
				providerId: "host-media",
				modelId: "host:media:image",
				outputKind: "image",
				aspectRatios: ["1:1"],
			}),
			expect.objectContaining({
				providerId: "host-media",
				modelId: "host:media:video",
				outputKind: "video",
				aspectRatios: ["16:9"],
				resolutions: ["1080p"],
				durations: [4, 8],
			}),
		]);
	});

	it("forwards media handles without reading bytes in the plugin", async () => {
		const { media, createJob } = createMediaApi();
		createJob.mockResolvedValue({
			providerId: "host:media",
			id: "job-1",
			status: "succeeded",
			artifacts: [
				{
					id: "artifact-1",
					kind: "video",
					mimeType: "video/mp4",
					sizeBytes: 1024,
					durationSeconds: 4,
				},
			],
		});
		const readReference = vi.fn();
		const provider: ContentProviderAdapter = new HostMediaProvider(media, [providerDescriptor]);

		await expect(
			provider.generate(
				{
					providerId: "host-media",
					modelId: "host:media:video",
					modeId: "image-to-video",
					prompt: "animate",
					aspectRatio: "16:9",
					duration: 4,
					resolution: "1080p",
					references: [
						{
							id: "reference-1",
							slotId: "referenceImages",
							kind: "image",
							mimeType: "image/png",
							source: { type: "plugin-blob", blobId: "blob-1" },
						},
					],
				},
				{ readReference },
			),
		).resolves.toEqual({
			kind: "video",
			mimeType: "video/mp4",
			source: { type: "host-artifact", artifactId: "artifact-1" },
			width: undefined,
			height: undefined,
			duration: 4,
		});
		expect(readReference).not.toHaveBeenCalled();
		expect(createJob).toHaveBeenCalledWith({
			providerId: "host:media",
			kind: "video",
			mode: "image-to-video",
			prompt: "animate",
			aspectRatio: "16:9",
			dimensions: { width: 1820, height: 1024 },
			resolution: "1080p",
			durationSeconds: 4,
			references: [
				{
					id: "reference-1",
					kind: "image",
					mimeType: "image/png",
					source: { type: "plugin-blob", blobId: "blob-1" },
				},
			],
		});
	});

	it("polls queued jobs and maps the completed artifact handle", async () => {
		vi.useFakeTimers();
		try {
			const { media, createJob, getJob } = createMediaApi();
			createJob.mockResolvedValue({ providerId: "host:media", id: "job-2", status: "queued" });
			getJob.mockResolvedValue({
				providerId: "host:media",
				id: "job-2",
				status: "succeeded",
				artifacts: [{ id: "artifact-2", kind: "image", mimeType: "image/webp", sizeBytes: 32 }],
			});
			const provider = new HostMediaProvider(media, [providerDescriptor]);
			const generated = provider.generate({
				providerId: "host-media",
				modelId: "host:media:image",
				modeId: "text-to-image",
				prompt: "draw",
				references: [],
			});

			await vi.advanceTimersByTimeAsync(1000);

			await expect(generated).resolves.toMatchObject({
				kind: "image",
				mimeType: "image/webp",
				source: { type: "host-artifact", artifactId: "artifact-2" },
			});
			expect(getJob).toHaveBeenCalledWith({ providerId: "host:media", id: "job-2" });
		} finally {
			vi.useRealTimers();
		}
	});

	it("preserves structured host failures", async () => {
		const { media, createJob } = createMediaApi();
		createJob.mockResolvedValue({
			providerId: "host:media",
			id: "job-3",
			status: "failed",
			error: { code: "quota-exhausted", message: "quota exhausted", retryable: false },
		});
		const provider = new HostMediaProvider(media, [providerDescriptor]);

		await expect(
			provider.generate({
				providerId: "host-media",
				modelId: "host:media:image",
				modeId: "text-to-image",
				prompt: "draw",
				references: [],
			}),
		).rejects.toMatchObject({ code: "quota-exhausted", message: "quota exhausted", retryable: false });
	});

	it("reports the expected artifact kind when a host result is incomplete", async () => {
		const { media, createJob } = createMediaApi();
		createJob.mockResolvedValue({
			providerId: "host:media",
			id: "job-4",
			status: "succeeded",
			artifacts: [{ id: "artifact-image", kind: "image", mimeType: "image/png", sizeBytes: 16 }],
		});
		const provider = new HostMediaProvider(media, [providerDescriptor]);

		await expect(
			provider.generate({
				providerId: "host-media",
				modelId: "host:media:video",
				modeId: "text-to-video",
				prompt: "animate",
				references: [],
			}),
		).rejects.toMatchObject({
			code: "provider-failed",
			message: "host media provider returned no video artifact: host:media",
		});
	});
});
