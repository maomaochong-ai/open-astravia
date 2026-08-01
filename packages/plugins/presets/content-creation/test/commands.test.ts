import { describe, expect, it } from "vitest";
import { applyContentProjectCommands, ContentProjectCommandError } from "../src/domain/commands";
import { createContentProject } from "../src/domain/model";

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
		expect(next.graph.edges).toHaveLength(1);
		expect(project.graph.nodes).toHaveLength(0);
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

