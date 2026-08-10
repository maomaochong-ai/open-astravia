import { describe, expect, it } from "vitest";
import {
	contentAgentOperationsAreDestructive,
	parseContentAgentOperations,
} from "../src/agent/operations";
import { applyContentProjectCommands } from "../src/project/commands";
import { createContentProject } from "../src/project/types";

describe("content agent operations", () => {
	it("translates semantic edits and places new nodes without canvas coordinates", () => {
		const project = applyContentProjectCommands(createContentProject("C:/project"), [
			{
				type: "node.add",
				node: { id: "prompt", kind: "prompt", position: { x: 10, y: 20 } },
			},
		]);
		const commands = parseContentAgentOperations(project, [
			{
				type: "add_node",
				id: "video",
				kind: "video-generator",
				afterNodeId: "prompt",
				name: "主视频",
				purpose: "生成最终成片",
				prompt: "A cinematic product reveal",
				modelSelection: "specific",
				providerId: "host-media",
				modelId: "video-model",
				modeId: "text-to-video",
			},
		]);

		const next = applyContentProjectCommands(project, commands);
		const video = next.graph.nodes.find((node) => node.id === "video");
		expect(video).toMatchObject({
			name: "主视频",
			purpose: "生成最终成片",
			position: { x: 410, y: 20 },
			data: {
				prompt: "A cinematic product reveal",
				providerId: "host-media",
				modelId: "video-model",
				modeId: "text-to-video",
			},
		});
	});

	it("clears a specific model when automatic selection is requested", () => {
		const project = applyContentProjectCommands(createContentProject("C:/project"), [
			{
				type: "node.add",
				node: {
					id: "image",
					kind: "image-generator",
					position: { x: 0, y: 0 },
					data: { providerId: "provider", modelId: "model", modeId: "text-to-image" },
				},
			},
		]);
		const commands = parseContentAgentOperations(project, [
			{ type: "update_node", nodeId: "image", modelSelection: "automatic" },
		]);

		const next = applyContentProjectCommands(project, commands);
		expect(next.graph.nodes[0]?.data).toMatchObject({
			providerId: undefined,
			modelId: undefined,
			modeId: undefined,
		});
	});

	it("requires preview confirmation for deletion commands", () => {
		const project = createContentProject("C:/project");
		const commands = parseContentAgentOperations(project, [{ type: "delete_node", nodeId: "node" }]);

		expect(contentAgentOperationsAreDestructive(commands)).toBe(true);
		expect(() =>
			parseContentAgentOperations(project, [
				{ type: "add_node", kind: "video-generator", modelSelection: "specific" },
			]),
		).toThrow("specific model selection requires providerId and modelId");
	});

	it("assigns stable ids to previewable duplicate, connection, and timeline commands", () => {
		const project = createContentProject("C:/project");
		const commands = parseContentAgentOperations(project, [
			{ type: "duplicate_node", nodeId: "source" },
			{ type: "connect_nodes", source: "source", target: "target" },
			{ type: "add_timeline_clip", nodeId: "source", start: 0, duration: 5 },
		]);

		expect(commands).toEqual([
			expect.objectContaining({ type: "node.duplicate", id: expect.any(String) }),
			expect.objectContaining({ type: "edge.connect", id: expect.any(String) }),
			expect.objectContaining({ type: "timeline.clip.add", clip: expect.objectContaining({ id: expect.any(String) }) }),
		]);
	});
});
