import type {
	PluginArtifactsApi,
	PluginAgentToolRegistration,
	PluginContext,
	PluginImageRef,
	PluginJobsApi,
	PluginMediaArtifact,
	PluginMediaApi,
	PluginMediaJob,
} from "@vetta-org/plugin-sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ImageRepository } from "./image-repository";
import { registerImageTools } from "./image-tools";

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
	const wait = vi.fn<PluginJobsApi["wait"]>();
	const persistArtifact = vi.fn<PluginArtifactsApi["persist"]>();
	const releaseArtifact = vi.fn<PluginArtifactsApi["release"]>();
	const persist = vi.fn<ImageRepository["persist"]>();
	const read = vi.fn<ImageRepository["read"]>();
	const lineage = vi.fn<ImageRepository["lineage"]>();
	const sessionLineages = vi.fn<ImageRepository["sessionLineages"]>();
	const openActivityTab = vi.fn();
	const media: PluginMediaApi = {
		registerProvider: vi.fn(),
		listProviders,
		onProvidersChanged: vi.fn(),
		submit,
	};
	const jobs: PluginJobsApi = { get: vi.fn(), cancel: vi.fn(), wait };
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
	} as unknown as PluginContext;

	beforeEach(() => {
		registrations.clear();
		vi.clearAllMocks();
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

	// 两个工具每次调用都产生外部计费且不可撤销，描述必须自带排除段（改造方案 1.1）。
	it.each(["generate-image", "edit-image"])(
		"%s describes when NOT to use it and its only legitimate scenario",
		(id) => {
			const description = tool(id).description ?? "";
			expect(description).toMatch(/\bDo NOT use\b/);
			expect(description).toMatch(/\bOnly for\b/);
		},
	);

	// 外部计费工具在注册处声明 heavy，由宿主首调确认闸兜底。
	it.each(["generate-image", "edit-image"])("%s declares heavy side effect at registration", (id) => {
		expect(tool(id).side_effect).toBe("heavy");
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
			{ sessionId: "session-1" },
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
