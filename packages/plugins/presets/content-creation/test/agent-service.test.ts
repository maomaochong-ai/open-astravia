import { describe, expect, it, vi } from "vitest";
import { ContentCreationAgentService } from "../src/agent/service";
import type { ContentGenerationService } from "../src/generation/generation-service";
import { serializeContentProject, serializeContentProjectRuntime } from "../src/project/persistence";
import type { ContentProjectRepository } from "../src/project/repository";
import type { ContentProjectDocument } from "../src/project/types";
import { ContentCreationWorkspace } from "../src/project/workspace";

function createMemoryRepository(): ContentProjectRepository {
	const projects = new Map<string, ContentProjectDocument>();
	return {
		read: async (cwd) => {
			const project = projects.get(cwd ?? "__global__");
			return project
				? { document: serializeContentProject(project), runtime: serializeContentProjectRuntime(project) }
				: null;
		},
		write: async (cwd, project) => {
			projects.set(cwd ?? "__global__", structuredClone(project));
		},
	};
}

function createAgentHarness() {
	const workspace = new ContentCreationWorkspace(createMemoryRepository());
	const runNode = vi.fn(async (cwd: string | null, _nodeId: string) => await workspace.load(cwd));
	const generation = {
		listModels: () => [],
		runNode,
	} as unknown as ContentGenerationService;
	return {
		workspace,
		runNode,
		agent: new ContentCreationAgentService(workspace, () => generation),
	};
}

describe("ContentCreationAgentService", () => {
	it("applies small safe edits and previews destructive or broad edits automatically", async () => {
		const { agent } = createAgentHarness();
		const applied = await agent.edit("C:/project", [
			{ type: "add_node", id: "prompt", kind: "prompt", name: "Prompt" },
		]);
		expect(applied).toMatchObject({ kind: "applied", project: { graph: { nodes: [{ id: "prompt" }] } } });

		const destructive = await agent.edit("C:/project", [{ type: "delete_node", nodeId: "prompt" }]);
		expect(destructive).toMatchObject({
			kind: "preview",
			preview: { destructive: true, diff: { removedNodeIds: ["prompt"] } },
		});

		const broad = await agent.edit(
			"C:/broad",
			Array.from({ length: 7 }, (_, index) => ({
				type: "add_node",
				id: `prompt-${index}`,
				kind: "prompt",
				name: `Prompt ${index}`,
			})),
		);
		expect(broad).toMatchObject({ kind: "preview", preview: { destructive: false } });
		if (broad.kind === "preview") expect(broad.preview.diff.addedNodeIds).toHaveLength(7);
	});

	it("previews and commits destructive changes against the inspected revision", async () => {
		const { workspace, agent } = createAgentHarness();
		const project = await workspace.dispatch("C:/project", [
			{ type: "node.add", node: { id: "prompt", kind: "prompt", position: { x: 0, y: 0 } } },
		]);

		await expect(
			agent.apply("C:/project", [{ type: "delete_node", nodeId: "prompt" }], project.revision),
		).rejects.toThrow("destructive operations require");
		const preview = await agent.preview(
			"C:/project",
			[{ type: "delete_node", nodeId: "prompt" }],
			project.revision,
		);
		expect(preview).toMatchObject({ destructive: true, diff: { removedNodeIds: ["prompt"] } });

		const committed = await agent.commitPreview(preview.token);
		expect(committed.graph.nodes).toHaveLength(0);
		await expect(agent.commitPreview(preview.token)).rejects.toThrow("expired or was not found");
	});

	it("rejects a preview when the workflow changed before confirmation", async () => {
		const { workspace, agent } = createAgentHarness();
		const project = await workspace.dispatch("C:/project", [
			{ type: "node.add", node: { id: "prompt", kind: "prompt", position: { x: 0, y: 0 } } },
		]);
		const preview = await agent.preview(
			"C:/project",
			[{ type: "rename_node", nodeId: "prompt", name: "新的提示词" }],
			project.revision,
		);
		await workspace.dispatch("C:/project", [
			{ type: "node.set-purpose", nodeId: "prompt", purpose: "并行修改" },
		]);

		await expect(agent.commitPreview(preview.token)).rejects.toThrow("project revision conflict");
	});

	it("reports replaced connections as both removed and added", async () => {
		const { workspace, agent } = createAgentHarness();
		const project = await workspace.dispatch("C:/project", [
			{ type: "node.add", node: { id: "first", kind: "prompt", position: { x: 0, y: 0 } } },
			{ type: "node.add", node: { id: "second", kind: "prompt", position: { x: 0, y: 200 } } },
			{ type: "node.add", node: { id: "image", kind: "image-generator", position: { x: 400, y: 0 } } },
			{ type: "edge.connect", id: "old-edge", source: "first", target: "image" },
		]);
		const preview = await agent.preview(
			"C:/project",
			[
				{ type: "delete_edge", edgeId: "old-edge" },
				{ type: "connect_nodes", id: "new-edge", source: "second", target: "image" },
			],
			project.revision,
		);

		expect(preview.diff).toMatchObject({ addedEdgeCount: 1, removedEdgeCount: 1 });
	});

	it("commits the same generated ids shown by the preview", async () => {
		const { workspace, agent } = createAgentHarness();
		const project = await workspace.dispatch("C:/project", [
			{ type: "node.add", node: { id: "source", kind: "prompt", position: { x: 0, y: 0 } } },
		]);
		const preview = await agent.preview(
			"C:/project",
			[{ type: "duplicate_node", nodeId: "source" }],
			project.revision,
		);

		const duplicateId = preview.diff.addedNodeIds[0];
		const committed = await agent.commitPreview(preview.token);
		expect(duplicateId).toBeTruthy();
		expect(committed.graph.nodes.some((node) => node.id === duplicateId)).toBe(true);
	});

	it("runs selected generation nodes in dependency order after explicit confirmation", async () => {
		const { workspace, agent, runNode } = createAgentHarness();
		const project = await workspace.dispatch("C:/project", [
			{
				type: "node.add",
				node: { id: "image", kind: "image-generator", position: { x: 0, y: 0 }, data: { prompt: "image" } },
			},
			{
				type: "node.add",
				node: { id: "video", kind: "video-generator", position: { x: 400, y: 0 }, data: { prompt: "video" } },
			},
			{ type: "edge.connect", source: "image", target: "video", sourceHandle: "image", targetHandle: "image" },
		]);
		const run = await agent.prepareRun("C:/project", ["video", "image"], project.revision);

		expect(run.status).toBe("awaiting-confirmation");
		expect(run.nodeIds).toEqual(["image", "video"]);
		expect(runNode).not.toHaveBeenCalled();
		await agent.startRun(run.id);
		await vi.waitFor(() => expect(agent.getRun(run.id)?.status).toBe("succeeded"));
		expect(runNode.mock.calls.map((call) => call[1])).toEqual(["image", "video"]);
	});

	it("skips every downstream node after an upstream generation failure", async () => {
		const { workspace, agent, runNode } = createAgentHarness();
		runNode.mockRejectedValueOnce(new Error("provider failed"));
		const project = await workspace.dispatch("C:/project", [
			{
				type: "node.add",
				node: { id: "image", kind: "image-generator", position: { x: 0, y: 0 }, data: { prompt: "image" } },
			},
			{
				type: "node.add",
				node: { id: "video-a", kind: "video-generator", position: { x: 400, y: 0 }, data: { prompt: "a" } },
			},
			{
				type: "node.add",
				node: { id: "video-b", kind: "video-generator", position: { x: 800, y: 0 }, data: { prompt: "b" } },
			},
			{ type: "edge.connect", source: "image", target: "video-a", sourceHandle: "image", targetHandle: "image" },
			{ type: "edge.connect", source: "video-a", target: "video-b", sourceHandle: "video", targetHandle: "video" },
		]);
		const run = await agent.prepareRun("C:/project", undefined, project.revision);

		await agent.startRun(run.id);
		await vi.waitFor(() => expect(agent.getRun(run.id)?.status).toBe("failed"));
		expect(runNode).toHaveBeenCalledTimes(1);
		expect(agent.getRun(run.id)).toMatchObject({
			failedNodeIds: ["image"],
			skippedNodeIds: ["video-a", "video-b"],
		});
	});
});
