import { describe, expect, it, vi } from "vitest";
import type { ContentProjectDocument } from "../src/project/types";
import type { ContentProjectRepository } from "../src/project/repository";
import type {
	ContentProjectHistoryRepository,
	StoredContentProjectHistory,
} from "../src/project/history-repository";
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

function createMemoryHistoryRepository(): ContentProjectHistoryRepository {
	const histories = new Map<string, StoredContentProjectHistory>();
	return {
		read: async (projectId) => structuredClone(histories.get(projectId) ?? null),
		write: async (projectId, present, history) => {
			histories.set(projectId, {
				schemaVersion: 1,
				projectId,
				present: structuredClone(present),
				history: structuredClone(history),
			});
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

	it("undoes and redoes one dispatch batch while revisions keep increasing", async () => {
		const workspace = new ContentCreationWorkspace(createMemoryRepository());
		await workspace.dispatch("C:/project", [
			{ type: "node.add", node: { id: "prompt", kind: "prompt", position: { x: 0, y: 0 } } },
			{ type: "node.add", node: { id: "output", kind: "output", position: { x: 300, y: 0 } } },
			{ type: "edge.connect", source: "prompt", target: "output" },
		]);

		expect(workspace.getHistoryView("C:/project")).toMatchObject({ canUndo: true, canRedo: false });
		const undone = await workspace.undo("C:/project");
		expect(undone.graph.nodes).toHaveLength(0);
		expect(undone.revision).toBe(2);
		expect(workspace.getHistoryView("C:/project")).toMatchObject({ canUndo: false, canRedo: true });
		const redone = await workspace.redo("C:/project");
		expect(redone.graph.nodes).toHaveLength(2);
		expect(redone.graph.edges).toHaveLength(1);
		expect(redone.revision).toBe(3);
	});

	it("keeps redo available across runtime-only job updates", async () => {
		const workspace = new ContentCreationWorkspace(createMemoryRepository());
		await workspace.dispatch("C:/project", [
			{ type: "node.add", node: { id: "image", kind: "image-generator", position: { x: 0, y: 0 } } },
		]);
		await workspace.dispatch("C:/project", [
			{ type: "node.update", nodeId: "image", data: { prompt: "changed" } },
		]);
		await workspace.undo("C:/project");
		await workspace.dispatch("C:/project", [
			{ type: "job.start", job: { id: "job", nodeId: "image", providerId: "provider", modelId: "model", outputAssetId: "asset" } },
		]);
		await workspace.dispatch("C:/project", [
			{ type: "job.update", jobId: "job", status: "running", progress: 0.5 },
		]);

		expect(workspace.getHistoryView("C:/project").canRedo).toBe(true);
		const redone = await workspace.redo("C:/project");
		expect(redone.graph.nodes[0]?.data.prompt).toBe("changed");
		expect(redone.jobs[0]).toMatchObject({ id: "job", status: "running", progress: 0.5 });
	});

	it("allows lifecycle batches with editable fields to opt out of history", async () => {
		const workspace = new ContentCreationWorkspace(createMemoryRepository());
		await workspace.dispatch("C:/project", [
			{ type: "node.add", node: { id: "image", kind: "image-generator", position: { x: 0, y: 0 } } },
		]);
		await workspace.dispatch(
			"C:/project",
			[
				{ type: "node.update", nodeId: "image", data: { providerId: "provider", modelId: "model" } },
				{ type: "job.start", job: { id: "job", nodeId: "image", providerId: "provider", modelId: "model", outputAssetId: "asset" } },
			],
			undefined,
			{ record: false },
		);

		expect(workspace.getHistoryView("C:/project").undoAction).toEqual({ kind: "node.add", count: 1 });
		await workspace.dispatch("C:/project", [{ type: "job.fail", jobId: "job", error: "cancelled" }]);
		expect((await workspace.undo("C:/project")).graph.nodes).toHaveLength(0);
	});

	it("loads a compatible persisted history for the same project", async () => {
		const repository = createMemoryRepository();
		const historyRepository = createMemoryHistoryRepository();
		const first = new ContentCreationWorkspace(repository, { historyRepository });
		await first.dispatch("C:/project", [
			{ type: "node.add", node: { id: "prompt", kind: "prompt", position: { x: 0, y: 0 } } },
		]);

		const reloaded = new ContentCreationWorkspace(repository, { historyRepository });
		await reloaded.load("C:/project");
		expect(reloaded.getHistoryView("C:/project").canUndo).toBe(true);
		expect((await reloaded.undo("C:/project")).graph.nodes).toHaveLength(0);
	});

	it("keeps in-memory undo available when private history persistence fails", async () => {
		const onHistoryPersistenceError = vi.fn();
		const workspace = new ContentCreationWorkspace(createMemoryRepository(), {
			historyRepository: {
				read: async () => null,
				write: async () => {
					throw new Error("storage unavailable");
				},
			},
			onHistoryPersistenceError,
		});
		await workspace.dispatch("C:/project", [
			{ type: "node.add", node: { id: "prompt", kind: "prompt", position: { x: 0, y: 0 } } },
		]);

		expect(onHistoryPersistenceError).toHaveBeenCalledOnce();
		expect((await workspace.undo("C:/project")).graph.nodes).toHaveLength(0);
	});
});
