import { describe, expect, it } from "vitest";
import type { ContentModelDescriptor } from "../src/generation/types";
import { createContentProjectMenuSummary } from "../src/canvas/project-menu-summary";
import { createContentProject } from "../src/project/types";

describe("content project menu summary", () => {
	it("derives workspace and project-wide counts from the current snapshot", () => {
		const project = createContentProject("C:\\workspaces\\campaign\\");
		project.graph.nodes = [
			{ id: "image", kind: "image-generator", position: { x: 0, y: 0 }, status: "running", data: {} },
			{ id: "video", kind: "video-generator", position: { x: 400, y: 0 }, status: "failed", data: {} },
		];
		project.assets = [
			{ id: "asset", kind: "image", name: "Hero", mimeType: "image/png", createdAt: project.createdAt },
		];
		project.jobs = [
			createJob("running", "image", "running"),
			createJob("running-retry", "image", "queued"),
			createJob("failed", "video", "failed"),
			createJob("orphan", "removed-node", "running"),
		];
		const models = [createModel("provider", "image"), createModel("provider", "image"), createModel("provider", "video")];

		expect(createContentProjectMenuSummary(project, models)).toEqual({
			workspaceName: "campaign",
			nodeCount: 2,
			assetCount: 1,
			modelCount: 2,
			activeJobNodeIds: ["image"],
			failedJobNodeIds: ["video"],
		});
	});

	it("uses the global workspace fallback when no cwd is active", () => {
		const project = createContentProject(null);

		expect(createContentProjectMenuSummary(project, [])).toMatchObject({
			workspaceName: null,
			nodeCount: 0,
			assetCount: 0,
			modelCount: 0,
			activeJobNodeIds: [],
			failedJobNodeIds: [],
		});
	});
});

function createJob(id: string, nodeId: string, status: "queued" | "running" | "failed") {
	return {
		id,
		nodeId,
		provider: "provider",
		model: "model",
		status,
		progress: 0,
		createdAt: "2026-08-11T00:00:00.000Z",
		updatedAt: "2026-08-11T00:00:00.000Z",
	};
}

function createModel(providerId: string, modelId: string): ContentModelDescriptor {
	return {
		providerId,
		modelId,
		displayName: modelId,
		outputKind: modelId === "video" ? "video" : "image",
		modes: [],
		aspectRatios: [],
	};
}
