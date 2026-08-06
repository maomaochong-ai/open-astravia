import { describe, expect, it, vi } from "vitest";
import { createContentProject, type ContentProjectDocument } from "../src/project/types";
import { ContentGenerationService } from "../src/generation/generation-service";
import { ContentProviderRegistry } from "../src/generation/provider-registry";
import type { ContentArtifactStore, ContentProviderAdapter } from "../src/generation/types";
import type { ContentProjectRepository } from "../src/project/repository";
import { ContentCreationWorkspace } from "../src/project/workspace";

describe("ContentGenerationService", () => {
	it("runs a mocked provider and returns the stored artifact to the node", async () => {
		const fixture = await createFixture();

		const result = await fixture.service.runNode("C:/project", "image");

		expect(fixture.generate).toHaveBeenCalledWith(
			expect.objectContaining({
				modeId: "text-to-image",
				providerId: "mock",
				modelId: "mock-image",
				prompt: "A small lighthouse",
			}),
		);
		expect(fixture.putGenerated).toHaveBeenCalledOnce();
		expect(result.graph.nodes.find((node) => node.id === "image")).toMatchObject({
			status: "succeeded",
			data: { assetId: expect.any(String) },
		});
		expect(result.jobs[0]).toMatchObject({ status: "succeeded", provider: "mock", model: "mock-image" });
		expect(result.assets[0]).toMatchObject({
			kind: "image",
			mimeType: "image/png",
			filePath: expect.stringMatching(/^output\//),
		});
	});

	it("marks the job and node as failed when the provider rejects", async () => {
		const fixture = await createFixture();
		fixture.generate.mockRejectedValueOnce(new Error("provider unavailable"));

		await expect(fixture.service.runNode("C:/project", "image")).rejects.toThrow("provider unavailable");
		const project = fixture.workspace.getSnapshot("C:/project");
		expect(project?.graph.nodes.find((node) => node.id === "image")?.status).toBe("failed");
		expect(project?.jobs[0]).toMatchObject({ status: "failed", error: "provider unavailable" });
		expect(project?.assets).toHaveLength(0);
	});

	it("assigns reference-resolution failures to the corresponding node job", async () => {
		const fixture = await createFixture();
		await fixture.service.importReferences("C:/project", "image", [
			{ name: "missing.png", mimeType: "image/png", data: "reference-data" },
		]);
		fixture.read.mockRejectedValueOnce(new Error("reference unavailable"));

		await expect(fixture.service.runNode("C:/project", "image")).rejects.toThrow(
			"reference unavailable",
		);
		const project = fixture.workspace.getSnapshot("C:/project");
		expect(project?.graph.nodes.find((node) => node.id === "image")?.status).toBe("failed");
		expect(project?.jobs[0]).toMatchObject({ status: "failed", error: "reference unavailable" });
		expect(fixture.generate).not.toHaveBeenCalled();
	});

	it("runs video nodes through the same mode-based orchestration", async () => {
		const fixture = await createFixture("video-generator");

		const result = await fixture.service.runNode("C:/project", "image");

		expect(fixture.generate).toHaveBeenCalledWith(
			expect.objectContaining({
				modeId: "text-to-video",
				modelId: "mock-video",
				duration: 8,
				resolution: "1080p",
			}),
		);
		expect(result.assets[0]).toMatchObject({
			kind: "video",
			mimeType: "video/mp4",
			duration: 8,
			width: 1920,
			height: 1080,
		});
	});

	it("imports mixed media into one asset node without creating one node per file", async () => {
		const fixture = await createFixture();
		await fixture.workspace.dispatch("C:/project", [
			{ type: "node.add", node: { id: "assets", kind: "asset", position: { x: 500, y: 0 } } },
		]);

		const result = await fixture.service.importAssets("C:/project", "assets", [
			{ name: "reference.png", mimeType: "image/png", data: "image" },
			{ name: "clip.mp4", mimeType: "video/mp4", data: "video" },
			{ name: "voice.mp3", mimeType: "audio/mpeg", data: "audio" },
		]);

		expect(result.graph.nodes.find((node) => node.id === "assets")?.data.assetIds).toHaveLength(3);
		expect(result.graph.nodes.filter((node) => node.kind === "asset")).toHaveLength(1);
		expect(result.assets.map((asset) => asset.kind)).toEqual(["image", "video", "audio"]);
		expect(fixture.putImported).toHaveBeenCalledTimes(3);
	});

	it("imports media into a prompt and inherits it through the selected connected prompt", async () => {
		const fixture = await createFixture();
		await fixture.workspace.dispatch("C:/project", [
			{
				type: "node.add",
				node: {
					id: "prompt",
					kind: "prompt",
					position: { x: -300, y: 0 },
					data: { prompt: "A lighthouse at blue hour" },
				},
			},
			{
				type: "edge.connect",
				source: "prompt",
				target: "image",
				sourceHandle: "text",
				targetHandle: "prompt",
			},
			{
				type: "node.update",
				nodeId: "image",
				data: {
					promptDocument: {
						version: 1,
						segments: [{ type: "prompt-reference", sourceNodeId: "prompt" }],
					},
				},
			},
		]);
		const imported = await fixture.service.importReferences("C:/project", "prompt", [
			{ name: "mood.png", mimeType: "image/png", data: "reference-data" },
		]);

		expect(imported.graph.nodes.find((node) => node.id === "prompt")?.data.inputs).toMatchObject([
			{ slotId: "promptReferences" },
		]);
		expect(imported.graph.nodes.find((node) => node.id === "prompt")?.data.promptDocument).toMatchObject({
			version: 1,
			segments: [
				{ type: "text", text: "A lighthouse at blue hour" },
				{ type: "asset-reference", bindingId: expect.any(String) },
			],
		});
		await fixture.service.runNode("C:/project", "image");
		expect(fixture.read).toHaveBeenCalledWith(
			"C:/project",
			expect.objectContaining({ blobId: imported.assets[0]?.blobId }),
		);
		expect(fixture.generate).toHaveBeenLastCalledWith(
			expect.objectContaining({
				modeId: "image-to-image",
				prompt: "A lighthouse at blue hour",
				references: [
					expect.objectContaining({ kind: "image", slotId: "referenceImages", data: "reference-data" }),
				],
			}),
		);
	});
});

async function createFixture(kind: "image-generator" | "video-generator" = "image-generator") {
	const modeId = kind === "video-generator" ? "text-to-video" : "text-to-image";
	const modelId = kind === "video-generator" ? "mock-video" : "mock-image";
	const repository = new MemoryRepository();
	const workspace = new ContentCreationWorkspace(repository);
	await workspace.load("C:/project");
	await workspace.dispatch("C:/project", [
		{
			type: "node.add",
			node: {
				id: "image",
				kind,
				position: { x: 0, y: 0 },
				data: {
					prompt: "A small lighthouse",
					providerId: "mock",
					modelId,
					duration: kind === "video-generator" ? 8 : undefined,
					resolution: kind === "video-generator" ? "1080p" : undefined,
				},
			},
		},
	]);
	const generate = vi.fn<ContentProviderAdapter["generate"]>().mockResolvedValue({
		kind: kind === "video-generator" ? "video" : "image",
		data: kind === "video-generator" ? "AAAAIGZ0eXA" : "iVBORw0KGgoAAA",
		mimeType: kind === "video-generator" ? "video/mp4" : "image/png",
		duration: kind === "video-generator" ? 8 : undefined,
		width: kind === "video-generator" ? 1920 : undefined,
		height: kind === "video-generator" ? 1080 : undefined,
	});
	const provider: ContentProviderAdapter = {
		id: "mock",
		listModels: () => [
			{
				providerId: "mock",
				modelId,
				displayName: kind === "video-generator" ? "Mock Video" : "Mock Image",
				outputKind: kind === "video-generator" ? "video" : "image",
				modes:
					kind === "image-generator"
						? [
								{ id: "text-to-image", inputs: [] },
								{
									id: "image-to-image",
									inputs: [{ id: "referenceImages", accepts: ["image"], minItems: 1, maxItems: 4 }],
								},
							]
						: [{ id: modeId, inputs: [] }],
				aspectRatios: kind === "video-generator" ? ["16:9"] : ["1:1"],
			},
		],
		generate,
	};
	const providers = new ContentProviderRegistry();
	providers.register(provider);
	const putImported = vi.fn<ContentArtifactStore["putImported"]>().mockImplementation(async (id, content) => ({
		blobId: `stored-${id}`,
		mimeType: content.mimeType,
	}));
	const putGenerated = vi
		.fn<ContentArtifactStore["putGenerated"]>()
		.mockImplementation(async (_cwd, fileName, content) => ({
			filePath: `output/${fileName}`,
			mimeType: content.mimeType,
		}));
	const read = vi.fn<ContentArtifactStore["read"]>().mockResolvedValue({
		data: "reference-data",
		mimeType: "image/png",
	});
	const service = new ContentGenerationService(workspace, providers, { putImported, putGenerated, read });
	return { service, workspace, generate, putImported, putGenerated, read };
}

class MemoryRepository implements ContentProjectRepository {
	private project: ContentProjectDocument | null = null;

	async read(cwd: string | null): Promise<unknown> {
		return this.project ?? createContentProject(cwd, "2026-01-01T00:00:00.000Z");
	}

	async write(_cwd: string | null, project: ContentProjectDocument): Promise<void> {
		this.project = structuredClone(project);
	}
}
