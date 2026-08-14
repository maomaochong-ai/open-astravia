import { describe, expect, it } from "vitest";
import { applyContentProjectCommands } from "../src/project/commands";
import {
	captureContentProjectHistorySnapshot,
	contentProjectHistorySnapshotsEqual,
	ContentProjectHistoryConflictError,
	createContentProjectHistoryState,
	recordContentProjectHistory,
	redoContentProjectHistory,
	restoreContentProjectHistorySnapshot,
	undoContentProjectHistory,
} from "../src/project/history";
import { createContentProject } from "../src/project/types";

describe("content project history", () => {
	it("restores an atomic command batch and keeps revisions monotonic", () => {
		const initial = createContentProject("C:/project", "2026-08-12T00:00:00.000Z");
		const commands = [
			{ type: "node.add" as const, node: { id: "prompt", kind: "prompt" as const, position: { x: 0, y: 0 } } },
			{ type: "node.add" as const, node: { id: "output", kind: "output" as const, position: { x: 300, y: 0 } } },
			{ type: "edge.connect" as const, source: "prompt", target: "output" },
		];
		const changed = applyContentProjectCommands(initial, commands, "2026-08-12T00:01:00.000Z");
		const history = recordContentProjectHistory(
			createContentProjectHistoryState(),
			captureContentProjectHistorySnapshot(initial),
			captureContentProjectHistorySnapshot(changed),
			commands,
		);

		const undone = undoContentProjectHistory(changed, history, "2026-08-12T00:02:00.000Z");
		expect(undone?.project.graph.nodes).toHaveLength(0);
		expect(undone?.project.revision).toBe(2);
		const redone = undone && redoContentProjectHistory(undone.project, undone.history, "2026-08-12T00:03:00.000Z");
		expect(redone?.project.graph.nodes.map((node) => node.id)).toEqual(["prompt", "output"]);
		expect(redone?.project.graph.edges).toHaveLength(1);
		expect(redone?.project.revision).toBe(3);
	});

	it("ignores job progress and generated results when comparing editable history", () => {
		const project = applyContentProjectCommands(createContentProject("C:/project"), [
			{ type: "node.add", node: { id: "image", kind: "image-generator", position: { x: 0, y: 0 } } },
			{ type: "job.start", job: { id: "job", nodeId: "image", providerId: "provider", modelId: "model", outputAssetId: "asset" } },
		]);
		const progressed = applyContentProjectCommands(project, [
			{ type: "job.update", jobId: "job", status: "running", progress: 0.5 },
		]);
		const completed = applyContentProjectCommands(progressed, [
			{
				type: "job.succeed",
				jobId: "job",
				asset: {
					id: "asset",
					filePath: "output/image.png",
					kind: "image",
					name: "image.png",
					mimeType: "image/png",
					createdAt: "2026-08-12T00:00:00.000Z",
				},
			},
		]);

		expect(
			contentProjectHistorySnapshotsEqual(
				captureContentProjectHistorySnapshot(project),
				captureContentProjectHistorySnapshot(progressed),
			),
		).toBe(true);
		expect(
			contentProjectHistorySnapshotsEqual(
				captureContentProjectHistorySnapshot(project),
				captureContentProjectHistorySnapshot(completed),
			),
		).toBe(true);
	});

	it("preserves a current generation result while restoring older editable fields", () => {
		const configured = applyContentProjectCommands(createContentProject("C:/project"), [
			{ type: "node.add", node: { id: "image", kind: "image-generator", position: { x: 0, y: 0 } } },
			{ type: "node.update", nodeId: "image", data: { prompt: "first" } },
		]);
		const older = captureContentProjectHistorySnapshot(configured);
		let current = applyContentProjectCommands(configured, [
			{ type: "node.update", nodeId: "image", data: { prompt: "second" } },
			{ type: "job.start", job: { id: "job", nodeId: "image", providerId: "provider", modelId: "model", outputAssetId: "asset" } },
		]);
		current = applyContentProjectCommands(current, [
			{
				type: "job.succeed",
				jobId: "job",
				asset: {
					id: "asset",
					filePath: "output/image.png",
					kind: "image",
					name: "image.png",
					mimeType: "image/png",
					createdAt: "2026-08-12T00:00:00.000Z",
				},
			},
		]);

		const restored = restoreContentProjectHistorySnapshot(current, older);
		expect(restored.graph.nodes[0]?.data).toMatchObject({ prompt: "first", assetId: "asset" });
		expect(restored.assets.map((asset) => asset.id)).toContain("asset");
	});

	it("blocks restoring a snapshot that removes an active generation node", () => {
		const empty = createContentProject("C:/project");
		const active = applyContentProjectCommands(empty, [
			{ type: "node.add", node: { id: "image", kind: "image-generator", position: { x: 0, y: 0 } } },
			{ type: "job.start", job: { id: "job", nodeId: "image", providerId: "provider", modelId: "model", outputAssetId: "asset" } },
		]);

		expect(() => restoreContentProjectHistorySnapshot(active, captureContentProjectHistorySnapshot(empty))).toThrow(
			ContentProjectHistoryConflictError,
		);
	});

	it("coalesces consecutive frames with the same group id", () => {
		const initial = createContentProject("C:/project");
		const added = applyContentProjectCommands(initial, [
			{ type: "node.add", node: { id: "asset", kind: "asset", position: { x: 0, y: 0 } } },
		]);
		let history = recordContentProjectHistory(
			createContentProjectHistoryState(),
			captureContentProjectHistorySnapshot(initial),
			captureContentProjectHistorySnapshot(added),
			[{ type: "node.add", node: { id: "asset", kind: "asset", position: { x: 0, y: 0 } } }],
			{ groupId: "drop" },
		);
		const updated = applyContentProjectCommands(added, [
			{ type: "node.update", nodeId: "asset", data: { assetIds: ["media"] } },
		]);
		history = recordContentProjectHistory(
			history,
			captureContentProjectHistorySnapshot(added),
			captureContentProjectHistorySnapshot(updated),
			[{ type: "node.update", nodeId: "asset", data: { assetIds: ["media"] } }],
			{ groupId: "drop" },
		);

		expect(history.past).toHaveLength(1);
		expect(history.past[0]?.snapshot.nodes).toHaveLength(0);
	});
});
