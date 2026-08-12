import type {
	PluginAgentToolRegistration,
	PluginContext,
	PluginImageRef,
	PluginMediaApi,
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
	const createJob = vi.fn<PluginMediaApi["createJob"]>();
	const getJob = vi.fn<PluginMediaApi["getJob"]>();
	const cancelJob = vi.fn<PluginMediaApi["cancelJob"]>();
	const saveArtifact = vi.fn<PluginMediaApi["saveArtifact"]>();
	const releaseArtifact = vi.fn<PluginMediaApi["releaseArtifact"]>();
	const persist = vi.fn<ImageRepository["persist"]>();
	const read = vi.fn<ImageRepository["read"]>();
	const lineage = vi.fn<ImageRepository["lineage"]>();
	const sessionLineages = vi.fn<ImageRepository["sessionLineages"]>();
	const openActivityTab = vi.fn();
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
	const repository: ImageRepository = { persist, read, lineage, sessionLineages };
	const ctx = {
		media,
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
				capabilities: [{ kind: "image", modes: ["text-to-image", "image-to-image"] }],
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
		createJob.mockResolvedValue({
			providerId: "desktop-app:vetta",
			id: "job-1",
			status: "succeeded",
			artifacts: [{ id: "artifact-1", kind: "image", mimeType: "image/png", sizeBytes: 128 }],
		});
		saveArtifact.mockResolvedValue({
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
		expect(createJob).toHaveBeenCalledWith({
			providerId: "desktop-app:vetta",
			kind: "image",
			mode: "text-to-image",
			prompt: "draw a fox",
			dimensions: { width: 1280, height: 720 },
			references: [],
		});
		expect(saveArtifact).toHaveBeenCalledWith({
			artifactId: "artifact-1",
			destination: { type: "plugin-blob" },
		});
		expect(releaseArtifact).toHaveBeenCalledWith("artifact-1");
		expect(persist).toHaveBeenCalledWith(
			{ id: "blob-1", url: "vetta-media://local/blob-1", mimeType: "image/png" },
			{ sessionId: "session-1" },
		);
	});

	it("releases the temporary artifact when plugin persistence fails", async () => {
		createJob.mockResolvedValue({
			providerId: "desktop-app:vetta",
			id: "job-2",
			status: "succeeded",
			artifacts: [{ id: "artifact-2", kind: "image", mimeType: "image/png", sizeBytes: 64 }],
		});
		saveArtifact.mockRejectedValue(new Error("plugin storage unavailable"));

		await expect(
			tool<GenerateToolInput>("generate-image").handler(toolContext({ prompt: "draw" })),
		).rejects.toThrow("plugin storage unavailable");
		expect(releaseArtifact).toHaveBeenCalledWith("artifact-2");
		expect(persist).not.toHaveBeenCalled();
	});

	it("passes a local edit source as a workspace file handle", async () => {
		createJob.mockResolvedValue({
			providerId: "desktop-app:vetta",
			id: "job-3",
			status: "succeeded",
			artifacts: [{ id: "artifact-3", kind: "image", mimeType: "image/webp", sizeBytes: 96 }],
		});
		saveArtifact.mockResolvedValue({
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

		expect(createJob).toHaveBeenCalledWith(
			expect.objectContaining({
				mode: "image-to-image",
				references: [
					{ kind: "image", source: { type: "workspace-file", path: "C:/project/source.png" } },
				],
			}),
		);
		expect(read).not.toHaveBeenCalled();
		expect(releaseArtifact).toHaveBeenCalledWith("artifact-3");
	});
});
