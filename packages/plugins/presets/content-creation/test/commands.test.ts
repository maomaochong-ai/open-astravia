import { describe, expect, it } from "vitest";
import { applyContentProjectCommands, ContentProjectCommandError } from "../src/project/commands";
import { createContentProject } from "../src/project/types";

describe("applyContentProjectCommands", () => {
	it("applies a command batch atomically and increments one revision", () => {
		const project = createContentProject("C:/project", "2026-01-01T00:00:00.000Z");
		const next = applyContentProjectCommands(
			project,
			[
				{ type: "node.add", node: { id: "prompt", kind: "prompt", position: { x: 10, y: 20 } } },
				{ type: "node.add", node: { id: "video", kind: "video-generator", position: { x: 300, y: 20 } } },
				{ type: "edge.connect", source: "prompt", target: "video" },
			],
			"2026-01-02T00:00:00.000Z",
		);

		expect(next.revision).toBe(1);
		expect(next.updatedAt).toBe("2026-01-02T00:00:00.000Z");
		expect(next.graph.nodes).toHaveLength(2);
		expect(next.graph.nodes.map((node) => node.name)).toEqual(["prompt 1", "video-generator 1"]);
		expect(next.graph.edges).toHaveLength(1);
		expect(next.graph.edges[0]).toMatchObject({ sourceHandle: "text", targetHandle: "prompt" });
		expect(next.graph.nodes[1]?.data).toEqual({ duration: 5, resolution: "720p" });
		expect(project.graph.nodes).toHaveLength(0);
	});

	it("persists an explicit node name and rejects empty renames", () => {
		const project = applyContentProjectCommands(createContentProject("C:/project"), [
			{ type: "node.add", node: { id: "prompt", kind: "prompt", name: "分镜提示词", position: { x: 0, y: 0 } } },
		]);
		const renamed = applyContentProjectCommands(project, [
			{ type: "node.rename", nodeId: "prompt", name: "电影提示词" },
		]);

		expect(renamed.graph.nodes[0]?.name).toBe("电影提示词");
		expect(() =>
			applyContentProjectCommands(renamed, [{ type: "node.rename", nodeId: "prompt", name: "  " }]),
		).toThrow(ContentProjectCommandError);
	});

	it("stores workflow intent and semantic node purpose", () => {
		const project = applyContentProjectCommands(createContentProject("C:/project"), [
			{
				type: "workflow.update",
				workflow: {
					title: "产品发布视频",
					objective: "生成一支介绍核心功能的短视频",
					deliverables: [{ type: "video", fromNode: "video", description: "最终成片" }],
				},
			},
			{
				type: "node.add",
				node: {
					id: "video",
					kind: "video-generator",
					name: "主视频",
					purpose: "根据分镜提示词生成最终成片",
					position: { x: 0, y: 0 },
				},
			},
		]);

		expect(project.workflow).toMatchObject({ title: "产品发布视频", deliverables: [{ fromNode: "video" }] });
		expect(project.graph.nodes[0]).toMatchObject({ purpose: "根据分镜提示词生成最终成片" });
	});

	it("rejects incompatible and cyclic connections while allowing multiple prompt sources", () => {
		const incompatible = applyContentProjectCommands(createContentProject("C:/project"), [
			{ type: "node.add", node: { id: "first", kind: "prompt", position: { x: 0, y: 0 } } },
			{ type: "node.add", node: { id: "second", kind: "prompt", position: { x: 200, y: 0 } } },
		]);
		expect(() =>
			applyContentProjectCommands(incompatible, [{ type: "edge.connect", source: "first", target: "second" }]),
		).toThrow(ContentProjectCommandError);

		const occupied = applyContentProjectCommands(createContentProject("C:/project"), [
			{ type: "node.add", node: { id: "first", kind: "prompt", position: { x: 0, y: 0 } } },
			{ type: "node.add", node: { id: "second", kind: "prompt", position: { x: 0, y: 100 } } },
			{ type: "node.add", node: { id: "image", kind: "image-generator", position: { x: 200, y: 0 } } },
			{ type: "edge.connect", source: "first", target: "image", targetHandle: "prompt" },
		]);
		const multiplePrompts = applyContentProjectCommands(occupied, [
				{ type: "edge.connect", source: "second", target: "image", targetHandle: "prompt" },
			]);
		expect(multiplePrompts.graph.edges).toHaveLength(2);

		const chained = applyContentProjectCommands(createContentProject("C:/project"), [
			{ type: "node.add", node: { id: "a", kind: "image-generator", position: { x: 0, y: 0 } } },
			{ type: "node.add", node: { id: "b", kind: "image-generator", position: { x: 200, y: 0 } } },
			{ type: "edge.connect", source: "a", target: "b", sourceHandle: "image", targetHandle: "reference" },
		]);
		expect(() =>
			applyContentProjectCommands(chained, [
				{ type: "edge.connect", source: "b", target: "a", sourceHandle: "image", targetHandle: "reference" },
			]),
		).toThrow("connection would create a cycle: b -> a -> b");
	});

	it("returns structured connection diagnostics", () => {
		const project = applyContentProjectCommands(createContentProject("C:/project"), [
			{ type: "node.add", node: { id: "prompt", kind: "prompt", position: { x: 0, y: 0 } } },
			{ type: "node.add", node: { id: "image", kind: "image-generator", position: { x: 300, y: 0 } } },
		]);

		try {
			applyContentProjectCommands(project, [
				{ type: "edge.connect", source: "prompt", target: "image", targetHandle: "reference" },
			]);
			throw new Error("expected connection failure");
		} catch (error) {
			expect(error).toBeInstanceOf(ContentProjectCommandError);
			expect(error).toMatchObject({ code: "connection-type-mismatch" });
		}
	});

	it("binds concrete assets and removes their bindings with the connection", () => {
		const project = applyContentProjectCommands(createContentProject("C:/project"), [
			{
				type: "asset.add",
				asset: {
					id: "asset-image",
					kind: "image",
					name: "reference.png",
					mimeType: "image/png",
					createdAt: "2026-01-01T00:00:00.000Z",
				},
			},
			{
				type: "node.add",
				node: { id: "assets", kind: "asset", position: { x: 0, y: 0 }, data: { assetIds: ["asset-image"] } },
			},
			{ type: "node.add", node: { id: "image", kind: "image-generator", position: { x: 300, y: 0 } } },
			{
				type: "node.bind-assets",
				sourceNodeId: "assets",
				targetNodeId: "image",
				assetIds: ["asset-image"],
				targetHandle: "reference",
				slotId: "referenceImages",
			},
		]);
		const edgeId = project.graph.edges[0]?.id;
		expect(project.graph.nodes.find((node) => node.id === "image")?.data.inputs).toEqual([
			expect.objectContaining({ assetId: "asset-image", sourceNodeId: "assets", slotId: "referenceImages" }),
		]);

		const disconnected = applyContentProjectCommands(project, [{ type: "edge.delete", edgeId: edgeId! }]);
		expect(disconnected.graph.nodes.find((node) => node.id === "image")?.data.inputs).toEqual([]);
	});

	it("duplicates a node with independent data and an offset position", () => {
		const project = applyContentProjectCommands(createContentProject("C:/project"), [
			{
				type: "node.add",
				node: { id: "source", kind: "image-generator", position: { x: 20, y: 30 }, data: { prompt: "A scene" } },
			},
		]);
		const next = applyContentProjectCommands(project, [{ type: "node.duplicate", nodeId: "source" }]);

		expect(next.graph.nodes).toHaveLength(2);
		expect(next.graph.nodes[1]).toMatchObject({ kind: "image-generator", position: { x: 60, y: 70 }, status: "idle" });
		expect(next.graph.nodes[1]?.data).toEqual(project.graph.nodes[0]?.data);
		expect(next.graph.nodes[1]?.data).not.toBe(project.graph.nodes[0]?.data);
	});

	it("locks node geometry until the node is unlocked", () => {
		const project = applyContentProjectCommands(createContentProject("C:/project"), [
			{ type: "node.add", node: { id: "node", kind: "prompt", position: { x: 10, y: 20 } } },
			{ type: "node.lock", nodeId: "node", locked: true },
		]);

		expect(() =>
			applyContentProjectCommands(project, [{ type: "node.move", nodeId: "node", position: { x: 40, y: 50 } }]),
		).toThrow(ContentProjectCommandError);
		const unlocked = applyContentProjectCommands(project, [{ type: "node.lock", nodeId: "node", locked: false }]);
		const moved = applyContentProjectCommands(unlocked, [
			{ type: "node.move", nodeId: "node", position: { x: 40, y: 50 } },
		]);
		expect(moved.graph.nodes[0]).toMatchObject({ locked: false, position: { x: 40, y: 50 } });
	});

	it("removes dependent edges and timeline clips with a node", () => {
		const project = applyContentProjectCommands(createContentProject("C:/project"), [
			{ type: "node.add", node: { id: "source", kind: "video-generator", position: { x: 0, y: 0 } } },
			{ type: "node.add", node: { id: "output", kind: "output", position: { x: 300, y: 0 } } },
			{ type: "edge.connect", source: "source", target: "output" },
			{
				type: "timeline.clip.add",
				clip: { id: "clip", trackId: "video-1", sourceNodeId: "source", start: 0, duration: 5, sourceIn: 0, speed: 1 },
			},
		]);

		const next = applyContentProjectCommands(project, [{ type: "node.delete", nodeId: "source" }]);

		expect(next.graph.edges).toHaveLength(0);
		expect(next.timeline.tracks[0]?.clips).toHaveLength(0);
	});

	it("moves and trims a clip while preserving timeline coordinates", () => {
		const project = applyContentProjectCommands(createContentProject("C:/project"), [
			{ type: "node.add", node: { id: "source", kind: "video-generator", position: { x: 0, y: 0 } } },
			{
				type: "timeline.clip.add",
				clip: { id: "clip", trackId: "video-1", sourceNodeId: "source", start: 2, duration: 6, sourceIn: 1, speed: 1 },
			},
		]);
		const next = applyContentProjectCommands(project, [
			{ type: "timeline.clip.move", clipId: "clip", trackId: "video-1", start: 8 },
			{ type: "timeline.clip.trim", clipId: "clip", sourceIn: 2.5, duration: 3.5 },
		]);

		expect(next.timeline.tracks[0]?.clips[0]).toMatchObject({ start: 8, sourceIn: 2.5, duration: 3.5 });
	});

	it("rejects invalid clip duration without mutating the source", () => {
		const project = applyContentProjectCommands(createContentProject("C:/project"), [
			{ type: "node.add", node: { id: "source", kind: "video-generator", position: { x: 0, y: 0 } } },
		]);

		expect(() =>
			applyContentProjectCommands(project, [
				{
					type: "timeline.clip.add",
					clip: { trackId: "video-1", sourceNodeId: "source", start: 0, duration: 0, sourceIn: 0, speed: 1 },
				},
			]),
		).toThrow(ContentProjectCommandError);
		expect(project.timeline.tracks[0]?.clips).toHaveLength(0);
	});
});
