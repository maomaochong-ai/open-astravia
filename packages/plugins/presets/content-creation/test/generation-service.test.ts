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
				capability: "text-to-image",
				providerId: "mock",
				modelId: "mock-image",
				prompt: "A small lighthouse",
			}),
		);
		expect(fixture.put).toHaveBeenCalledOnce();
		expect(result.graph.nodes.find((node) => node.id === "image")).toMatchObject({
			status: "succeeded",
			data: { assetId: expect.any(String) },
		});
		expect(result.jobs[0]).toMatchObject({ status: "succeeded", provider: "mock", model: "mock-image" });
		expect(result.assets[0]).toMatchObject({ kind: "image", mimeType: "image/png", url: "vetta-media://mock" });
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
});

async function createFixture() {
	const repository = new MemoryRepository();
	const workspace = new ContentCreationWorkspace(repository);
	await workspace.load("C:/project");
	await workspace.dispatch("C:/project", [
		{
			type: "node.add",
			node: {
				id: "image",
				kind: "image-generator",
				position: { x: 0, y: 0 },
				data: { prompt: "A small lighthouse", providerId: "mock", modelId: "mock-image" },
			},
		},
	]);
	const generate = vi.fn<ContentProviderAdapter["generate"]>().mockResolvedValue({
		kind: "image",
		data: "iVBORw0KGgoAAA",
		mimeType: "image/png",
	});
	const provider: ContentProviderAdapter = {
		id: "mock",
		listModels: () => [
			{
				providerId: "mock",
				modelId: "mock-image",
				capabilities: ["text-to-image"],
				aspectRatios: ["1:1"],
			},
		],
		generate,
	};
	const providers = new ContentProviderRegistry();
	providers.register(provider);
	const put = vi.fn<ContentArtifactStore["put"]>().mockResolvedValue({
		url: "vetta-media://mock",
		mimeType: "image/png",
	});
	const service = new ContentGenerationService(workspace, providers, { put });
	return { service, workspace, generate, put };
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
