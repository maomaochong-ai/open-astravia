import { describe, expect, it } from "vitest";
import type { ContentProjectDocument } from "../src/domain/model";
import type { ContentProjectRepository } from "../src/runtime/project-repository";
import { ContentCreationWorkspace, ContentProjectRevisionError } from "../src/runtime/workspace";

function createMemoryRepository(writeDelay = 0): ContentProjectRepository {
	const projects = new Map<string, unknown>();
	return {
		read: async (cwd) => projects.get(cwd ?? "__global__") ?? null,
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
});
