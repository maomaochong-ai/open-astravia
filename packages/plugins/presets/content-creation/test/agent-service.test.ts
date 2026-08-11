import { describe, expect, it, vi } from "vitest";
import { ContentCreationAgentService } from "../src/agent/service";
import type { ContentGenerationService } from "../src/generation/generation-service";
import type { ContentModelDescriptor } from "../src/generation/types";
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
		listModels: () => TEST_MODELS,
		runNode,
	} as unknown as ContentGenerationService;
	return {
		workspace,
		runNode,
		agent: new ContentCreationAgentService(workspace, () => generation),
	};
}

const TEST_MODELS: readonly ContentModelDescriptor[] = [
	{
		providerId: "test",
		modelId: "image",
		displayName: "Image",
		outputKind: "image",
		aspectRatios: ["1:1"],
		modes: [{ id: "text-to-image", inputs: [] }],
	},
	{
		providerId: "test",
		modelId: "video",
		displayName: "Video",
		outputKind: "video",
		aspectRatios: ["16:9"],
		modes: [
			{ id: "text-to-video", inputs: [] },
			{ id: "image-to-video", inputs: [{ id: "firstFrame", accepts: ["image"], minItems: 1, maxItems: 1 }] },
			{ id: "video-to-video", inputs: [{ id: "referenceVideos", accepts: ["video"], minItems: 1, maxItems: 1 }] },
		],
	},
];

describe("ContentCreationAgentService", () => {
	it("applies destructive and broad edits directly without confirmation", async () => {
		const { agent } = createAgentHarness();
		const applied = await agent.edit("C:/project", [
			{ type: "add_node", id: "prompt", kind: "prompt", name: "Prompt" },
		]);
		expect(applied.graph.nodes).toEqual([expect.objectContaining({ id: "prompt" })]);

		const deleted = await agent.edit("C:/project", [{ type: "delete_node", nodeId: "prompt" }]);
		expect(deleted.graph.nodes).toHaveLength(0);

		const broad = await agent.edit(
			"C:/broad",
			Array.from({ length: 7 }, (_, index) => ({
				type: "add_node",
				id: `prompt-${index}`,
				kind: "prompt",
				name: `Prompt ${index}`,
			})),
		);
		expect(broad.graph.nodes).toHaveLength(7);
	});

	it("applies edits against the inspected revision and rejects stale changes", async () => {
		const { workspace, agent } = createAgentHarness();
		const project = await workspace.dispatch("C:/project", [
			{ type: "node.add", node: { id: "prompt", kind: "prompt", position: { x: 0, y: 0 } } },
		]);
		await workspace.dispatch("C:/project", [
			{ type: "node.set-purpose", nodeId: "prompt", purpose: "并行修改" },
		]);

		await expect(
			agent.edit("C:/project", [{ type: "delete_node", nodeId: "prompt" }], project.revision),
		).rejects.toThrow("project revision conflict");
	});

	it("creates nodes and semantic connections atomically", async () => {
		const { agent } = createAgentHarness();
		const project = await agent.edit(
			"C:/project",
			[
				{ type: "add_node", id: "prompt", kind: "prompt", prompt: "Product photo" },
				{ type: "add_node", id: "image", kind: "image-generator" },
				{ type: "add_node", id: "output", kind: "output" },
				{ type: "connect_nodes", source: "prompt", target: "image", targetInput: "promptSources" },
				{ type: "connect_nodes", source: "image", target: "output", targetInput: "contentSources" },
			],
		);

		expect(project.graph.nodes).toHaveLength(3);
		expect(project.graph.edges).toEqual([
			expect.objectContaining({ source: "prompt", target: "image", sourceHandle: "text", targetHandle: "prompt" }),
			expect.objectContaining({ source: "image", target: "output", sourceHandle: "image", targetHandle: "content" }),
		]);
		expect(project.revision).toBe(1);
		expect(project.graph.nodes.every((node) => node.layoutOwnership === "automatic")).toBe(true);
		expect(project.graph.nodes[1]!.position.x).toBeGreaterThan(project.graph.nodes[0]!.position.x);
		expect(project.graph.nodes[2]!.position.x).toBeGreaterThan(project.graph.nodes[1]!.position.x);
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
			{ type: "edge.connect", source: "image", target: "video", sourceHandle: "image", targetHandle: "image", role: "firstFrame" },
		]);
		const run = await agent.prepareRun("C:/project", ["video"], project.revision);

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
			{ type: "edge.connect", source: "image", target: "video-a", sourceHandle: "image", targetHandle: "image", role: "firstFrame" },
			{ type: "edge.connect", source: "video-a", target: "video-b", sourceHandle: "video", targetHandle: "video", role: "referenceVideos" },
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

	it("refuses to prepare a roleless mechanical media connection", async () => {
		const { workspace, agent } = createAgentHarness();
		const project = await workspace.dispatch("C:/project", [
			{ type: "node.add", node: { id: "image", kind: "image-generator", position: { x: 0, y: 0 }, data: { prompt: "image" } } },
			{ type: "node.add", node: { id: "video", kind: "video-generator", position: { x: 400, y: 0 }, data: { prompt: "video" } } },
			{ type: "edge.connect", source: "image", target: "video", targetHandle: "image" },
		]);

		await expect(agent.prepareRun("C:/project", ["video"], project.revision)).rejects.toMatchObject({
			code: "generation-plan-not-ready",
		});
	});

	it("refuses to run a bare asset edge without concrete asset references", async () => {
		const { workspace, agent } = createAgentHarness();
		const project = await workspace.dispatch("C:/project", [
			{ type: "node.add", node: { id: "assets", kind: "asset", position: { x: 0, y: 0 } } },
			{ type: "node.add", node: { id: "image", kind: "image-generator", position: { x: 400, y: 0 }, data: { prompt: "image" } } },
			{ type: "edge.connect", source: "assets", target: "image" },
		]);

		await expect(agent.prepareRun("C:/project", ["image"], project.revision)).rejects.toMatchObject({
			code: "generation-plan-not-ready",
		});
	});
});
