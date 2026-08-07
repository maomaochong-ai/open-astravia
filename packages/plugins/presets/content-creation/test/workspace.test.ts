import { describe, expect, it } from "vitest";
import type { ContentProjectDocument } from "../src/project/types";
import type { ContentProjectRepository } from "../src/project/repository";
import { serializeContentProject, serializeContentProjectRuntime } from "../src/project/persistence";
import { ContentCreationWorkspace, ContentProjectRevisionError } from "../src/project/workspace";

function createMemoryRepository(writeDelay = 0): ContentProjectRepository {
	const projects = new Map<string, ContentProjectDocument>();
	return {
		read: async (cwd) => {
			const project = projects.get(cwd ?? "__global__");
			return project
				? { document: serializeContentProject(project), runtime: serializeContentProjectRuntime(project) }
				: null;
		},
		write: async (cwd, project: ContentProjectDocument) => {
			if (writeDelay > 0) await new Promise((resolve) => setTimeout(resolve, writeDelay));
			projects.set(cwd ?? "__global__", structuredClone(project));
		},
	};
}

describe("ContentCreationWorkspace", () => {
	it("serializes concurrent writes without losing commands", async () => {
		const workspace = new ContentCreationWorkspace(createMemoryRepository(5));
		await workspace.load("C:/project");

		await Promise.all([
			workspace.dispatch("C:/project", [
				{ type: "node.add", node: { id: "first", kind: "prompt", position: { x: 0, y: 0 } } },
			]),
			workspace.dispatch("C:/project", [
				{ type: "node.add", node: { id: "second", kind: "output", position: { x: 300, y: 0 } } },
			]),
		]);

		const project = workspace.getSnapshot("C:/project");
		expect(project?.revision).toBe(2);
		expect(project?.graph.nodes.map((node) => node.id)).toEqual(["first", "second"]);
	});

	it("rejects stale expected revisions", async () => {
		const workspace = new ContentCreationWorkspace(createMemoryRepository());
		await workspace.dispatch("C:/project", [
			{ type: "node.add", node: { id: "node", kind: "prompt", position: { x: 0, y: 0 } } },
		]);

		await expect(
			workspace.dispatch(
				"C:/project",
				[{ type: "node.update", nodeId: "node", data: { prompt: "stale" } }],
				0,
			),
		).rejects.toBeInstanceOf(ContentProjectRevisionError);
		expect(workspace.getSnapshot("C:/project")?.graph.nodes[0]?.data.prompt).toBeUndefined();
	});

	it("isolates projects by cwd", async () => {
		const workspace = new ContentCreationWorkspace(createMemoryRepository());
		await workspace.dispatch("C:/alpha", [
			{ type: "node.add", node: { id: "alpha", kind: "prompt", position: { x: 0, y: 0 } } },
		]);
		await workspace.load("C:/beta");

		expect(workspace.getSnapshot("C:/alpha")?.graph.nodes).toHaveLength(1);
		expect(workspace.getSnapshot("C:/beta")?.graph.nodes).toHaveLength(0);
	});

	it("persists default and manually resized canvas dimensions", async () => {
		const workspace = new ContentCreationWorkspace(createMemoryRepository());
		await workspace.dispatch("C:/project", [
			{ type: "node.add", node: { id: "image", kind: "image-generator", position: { x: 20, y: 30 } } },
		]);
		await workspace.dispatch("C:/project", [
			{ type: "node.resize", nodeId: "image", position: { x: 10, y: 15 }, width: 640, height: 640 },
		]);

		const node = workspace.getSnapshot("C:/project")?.graph.nodes[0];
		expect(node).toMatchObject({ position: { x: 10, y: 15 }, width: 640, height: 640 });
	});
});
