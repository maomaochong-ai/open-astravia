import type {
	PluginArtifactsApi,
	PluginAgentToolRegistration,
	PluginContext,
	PluginImageRef,
	PluginJob,
	PluginJobRef,
	PluginJobsApi,
	PluginJobWaitOptions,
	PluginMediaArtifact,
	PluginMediaApi,
	PluginMediaJob,
} from "@vetta-org/plugin-sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ImageRepository } from "./image-repository";
import { registerImageTools, selectImageProvider } from "./image-tools";

interface GenerateToolInput {
	prompt: string;
	size?: string;
}

interface EditToolInput extends GenerateToolInput {
	sourceImageId?: string;
	sourceImagePath?: string;
}

function toolContext<TInput>(input: TInput) {
	return {
		session: { id: "session-1" },
		trigger: { input },
	} as unknown as Parameters<PluginAgentToolRegistration<TInput>["handler"]>[0];
}

describe("image generation media tools", () => {
	const registrations = new Map<string, PluginAgentToolRegistration<unknown>>();
	const listProviders = vi.fn<PluginMediaApi["listProviders"]>();
	const submit = vi.fn<PluginMediaApi["submit"]>();
	const wait = vi.fn<
		(job: PluginJob | PluginJobRef | string, options?: PluginJobWaitOptions) => Promise<PluginJob>
	>();
	const persistArtifact = vi.fn<PluginArtifactsApi["persist"]>();
	const releaseArtifact = vi.fn<PluginArtifactsApi["release"]>();
	const persist = vi.fn<ImageRepository["persist"]>();
	const read = vi.fn<ImageRepository["read"]>();
	const lineage = vi.fn<ImageRepository["lineage"]>();
	const sessionLineages = vi.fn<ImageRepository["sessionLineages"]>();
	const openActivityTab = vi.fn();
	const getImageGeneration = vi.fn();
	const media: PluginMediaApi = {
		registerProvider: vi.fn(),
		listProviders,
		onProvidersChanged: vi.fn(),
		submit,
	};
	const jobs: PluginJobsApi = {
		get: vi.fn(),
		cancel: vi.fn(),
		wait: async <TJob extends PluginJob = PluginJob>(
			job: TJob | PluginJobRef | string,
			options?: PluginJobWaitOptions,
		): Promise<TJob> => (await wait(job, options)) as TJob,
	};
	const artifacts: PluginArtifactsApi = { persist: persistArtifact, release: releaseArtifact };
	const repository: ImageRepository = { persist, read, lineage, sessionLineages };
	const ctx = {
		media,
		jobs,
		artifacts,
		agent: {
			registerTool: (registration: PluginAgentToolRegistration<unknown>) => {
				registrations.set(registration.id, registration);
				return { dispose() {} };
			},
		},
		ui: { openActivityTab },
		official: { agent: { getImageGeneration } },
	} as unknown as PluginContext;

	beforeEach(() => {
		registrations.clear();
		vi.clearAllMocks();
		getImageGeneration.mockResolvedValue({});
		listProviders.mockResolvedValue([
			{
				id: "desktop-app:vetta",
				ownerId: "desktop-app",
				protocolVersion: 2,
				capabilities: [
					{ operation: "generate", kind: "image", modes: ["text-to-image", "image-to-image"] },
				],
			},
		]);
		releaseArtifact.mockResolvedValue();
		registerImageTools(ctx, repository);
	});

	function tool<TInput>(id: string): PluginAgentToolRegistration<TInput> {
		const registration = registrations.get(id);
		if (!registration) throw new Error(`tool was not registered: ${id}`);
		return registration as PluginAgentToolRegistration<TInput>;
	}

	// 两个工具每次调用都产生外部计费且不可撤销，描述必须自带排除段。
	it.each(["generate-image", "edit-image"])(
		"%s describes when NOT to use the billed operation",
		(id) => {
			const description = tool(id).description ?? "";
			expect(description).toMatch(/\bDo NOT use\b/);
			expect(description).toContain("Every call is billed");
		},
	);

	it("registers explicit positive routing for generated visual deliverables", () => {
		const description = tool("generate-image").description ?? "";
		expect(description).toContain("actual visual deliverable");
		expect(description).toContain("brief requests in any language");
		expect(description).toContain("Use `edit_image` only when modifying an existing image");
	});

	// 注册合同不再携带工具副作用分级。
	it.each(["generate-image", "edit-image"])("%s registers without side-effect metadata", (id) => {
		expect(tool(id)).not.toHaveProperty("side_effect");
	});

	it("saves the generated artifact as a plugin blob and releases the temporary handle", async () => {
		const artifact = imageArtifact("artifact-1", "image/png", 128);
		const job = succeededJob("job-1", artifact);
		submit.mockResolvedValue(job);
		wait.mockResolvedValue(job);
		persistArtifact.mockResolvedValue({
			type: "plugin-blob",
			blobId: "blob-1",
			url: "vetta-media://local/blob-1",
			mimeType: "image/png",
			sizeBytes: 128,
		});
		const image: PluginImageRef = {
			id: "blob-1",
			rootId: "blob-1",
			url: "vetta-media://local/blob-1",
			mimeType: "image/png",
		};
		persist.mockResolvedValue(image);

		await expect(
			tool<GenerateToolInput>("generate-image").handler(toolContext({ prompt: "draw a fox", size: "1280x720" })),
		).resolves.toMatchObject({ ok: true, images: [image] });
		expect(submit).toHaveBeenCalledWith({
			operation: "generate",
			providerId: "desktop-app:vetta",
			kind: "image",
			mode: "text-to-image",
			prompt: "draw a fox",
			dimensions: { width: 1280, height: 720 },
			inputs: [],
		});
		expect(wait).toHaveBeenCalledWith(job, { pollIntervalMs: 1_000 });
		expect(persistArtifact).toHaveBeenCalledWith(artifact, { type: "plugin-blob" });
		expect(releaseArtifact).toHaveBeenCalledWith(artifact);
		expect(persist).toHaveBeenCalledWith(
			{ id: "blob-1", url: "vetta-media://local/blob-1", mimeType: "image/png" },
			{ providerId: "desktop-app:vetta", sessionId: "session-1" },
		);
	});

	it("uses the configured provider and model and preserves the provider id on the image record", async () => {
		getImageGeneration.mockResolvedValue({
			textToImageProviderId: "remote:images",
			textToImageModelId: "google/gemini-image",
		});
		listProviders.mockResolvedValue([
			{
				id: "desktop-app:vetta",
				ownerId: "desktop-app",
				protocolVersion: 2,
				capabilities: [{
					operation: "generate",
					kind: "image",
					modes: ["text-to-image"],
					models: [{ id: "google/gemini-image", modes: ["text-to-image"] }],
				}],
			},
			{
				id: "remote:images",
				ownerId: "remote",
				protocolVersion: 2,
				displayName: "Remote Images",
				capabilities: [{ operation: "generate", kind: "image", modes: ["text-to-image"] }],
			},
		]);
		const artifact = imageArtifact("artifact-preferred", "image/png", 32);
		const job = succeededJob("job-preferred", artifact);
		submit.mockResolvedValue(job);
		wait.mockResolvedValue(job);
		persistArtifact.mockResolvedValue({
			type: "plugin-blob",
			blobId: "blob-preferred",
			url: "vetta-media://local/blob-preferred",
			mimeType: "image/png",
			sizeBytes: 32,
		});
		persist.mockResolvedValue({
			id: "blob-preferred",
			rootId: "blob-preferred",
			url: "vetta-media://local/blob-preferred",
			mimeType: "image/png",
			providerId: "remote:images",
		});

		await tool<GenerateToolInput>("generate-image").handler(toolContext({ prompt: "draw" }));

		expect(submit).toHaveBeenCalledWith(expect.objectContaining({
			providerId: "remote:images",
			modelId: "google/gemini-image",
		}));
		expect(persist).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({ providerId: "remote:images" }),
		);
	});

	it("releases the temporary artifact when plugin persistence fails", async () => {
		const artifact = imageArtifact("artifact-2", "image/png", 64);
		const job = succeededJob("job-2", artifact);
		submit.mockResolvedValue(job);
		wait.mockResolvedValue(job);
		persistArtifact.mockRejectedValue(new Error("plugin storage unavailable"));

		await expect(
			tool<GenerateToolInput>("generate-image").handler(toolContext({ prompt: "draw" })),
		).rejects.toThrow("plugin storage unavailable");
		expect(releaseArtifact).toHaveBeenCalledWith(artifact);
		expect(persist).not.toHaveBeenCalled();
	});

	it("passes a local edit source as a workspace file handle", async () => {
		const artifact = imageArtifact("artifact-3", "image/webp", 96);
		const job = succeededJob("job-3", artifact);
		submit.mockResolvedValue(job);
		wait.mockResolvedValue(job);
		persistArtifact.mockResolvedValue({
			type: "plugin-blob",
			blobId: "blob-3",
			url: "vetta-media://local/blob-3",
			mimeType: "image/webp",
			sizeBytes: 96,
		});
		persist.mockResolvedValue({
			id: "blob-3",
			rootId: "blob-3",
			url: "vetta-media://local/blob-3",
			mimeType: "image/webp",
		});

		await tool<EditToolInput>("edit-image").handler(
			toolContext({ prompt: "add snow", sourceImagePath: "C:/project/source.png" }),
		);

		expect(submit).toHaveBeenCalledWith(
			expect.objectContaining({
				mode: "image-to-image",
				inputs: [
					{ kind: "image", source: { type: "workspace-file", path: "C:/project/source.png" } },
				],
			}),
		);
		expect(read).not.toHaveBeenCalled();
		expect(releaseArtifact).toHaveBeenCalledWith(artifact);
	});
});

describe("selectImageProvider", () => {
	const providers = [
		{
			id: "desktop-app:vetta",
			ownerId: "desktop-app",
			protocolVersion: 2 as const,
			capabilities: [{ operation: "generate" as const, kind: "image" as const, modes: ["text-to-image" as const] }],
		},
		{
			id: "remote:images",
			ownerId: "remote",
			protocolVersion: 2 as const,
			capabilities: [{ operation: "generate" as const, kind: "image" as const, modes: ["text-to-image" as const] }],
		},
	];

	it("prefers the configured provider over the built-in provider", () => {
		expect(selectImageProvider(providers, "text-to-image", "remote:images").id).toBe("remote:images");
	});

	it("fails closed when a configured provider is unavailable", () => {
		expect(() => selectImageProvider(providers, "text-to-image", "missing:provider")).toThrow(
			"selected image provider is unavailable",
		);
	});

	it("keeps the built-in provider as the automatic default", () => {
		expect(selectImageProvider(providers, "text-to-image").id).toBe("desktop-app:vetta");
	});
});

function imageArtifact(id: string, mimeType: string, sizeBytes: number): PluginMediaArtifact {
	return { id, kind: "image", mimeType, sizeBytes, lifetime: "temporary" };
}

function succeededJob(id: string, artifact: PluginMediaArtifact): PluginMediaJob {
	return {
		id,
		domain: "media",
		operation: "generate",
		status: "succeeded",
		artifacts: [artifact],
	};
}
