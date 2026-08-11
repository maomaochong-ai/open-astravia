import { describe, expect, it } from "vitest";
import {
	CONTENT_AGENT_OPERATION_SCHEMA,
	parseContentAgentOperations,
} from "../src/agent/operations";
import { applyContentProjectCommands } from "../src/project/commands";
import { createContentProject } from "../src/project/types";
import type { ContentModelDescriptor } from "../src/generation/types";

const FRAME_VIDEO_MODEL: ContentModelDescriptor = {
	providerId: "host-media",
	modelId: "frame-video",
	displayName: "Frame video",
	outputKind: "video",
	aspectRatios: ["16:9"],
	modes: [{
		id: "image-to-video",
		inputs: [
			{ id: "firstFrame", accepts: ["image"], minItems: 0, maxItems: 1 },
			{ id: "lastFrame", accepts: ["image"], minItems: 0, maxItems: 1 },
		],
		minTotalItems: 1,
	}],
};

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

	it("validates model configuration without adding an edit confirmation path", () => {
		const project = createContentProject("C:/project");
		expect(() =>
			parseContentAgentOperations(project, [
				{ type: "add_node", kind: "video-generator", modelSelection: "specific" },
			]),
		).toThrow("specific model selection requires providerId and modelId");
	});

	it("assigns stable ids and maps semantic connection inputs to internal handles", () => {
		const project = applyContentProjectCommands(createContentProject("C:/project"), [
			{ type: "node.add", node: { id: "source", kind: "prompt", position: { x: 0, y: 0 } } },
			{ type: "node.add", node: { id: "target", kind: "image-generator", position: { x: 400, y: 0 } } },
		]);
		const commands = parseContentAgentOperations(project, [
			{ type: "duplicate_node", nodeId: "source" },
			{ type: "connect_nodes", source: "source", target: "target", targetInput: "promptSources" },
		]);

		expect(commands).toEqual([
			expect.objectContaining({ type: "node.duplicate", id: expect.any(String) }),
			expect.objectContaining({ type: "edge.connect", id: expect.any(String), targetHandle: "prompt" }),
		]);
		expect(CONTENT_AGENT_OPERATION_SCHEMA.items.properties).not.toHaveProperty("sourceHandle");
		expect(CONTENT_AGENT_OPERATION_SCHEMA.items.properties).not.toHaveProperty("targetHandle");
	});

	it("normalizes legacy and internal target input names after tool validation", () => {
		const project = applyContentProjectCommands(createContentProject("C:/project"), [
			{ type: "node.add", node: { id: "prompt", kind: "prompt", position: { x: 0, y: 0 } } },
			{ type: "node.add", node: { id: "image", kind: "image-generator", position: { x: 400, y: 0 } } },
			{ type: "node.add", node: { id: "output", kind: "output", position: { x: 800, y: 0 } } },
		]);

		const commands = parseContentAgentOperations(project, [
			{ type: "connect_nodes", source: "prompt", target: "image", targetInput: "prompt" },
			{ type: "connect_nodes", source: "image", target: "output", targetInput: "content" },
		]);

		expect(commands).toEqual([
			expect.objectContaining({ type: "edge.connect", targetHandle: "prompt" }),
			expect.objectContaining({ type: "edge.connect", targetHandle: "content" }),
		]);
	});

	it("compiles video intent into model-backed role bindings in the same node batch", () => {
		const project = createContentProject("C:/project");
		const commands = parseContentAgentOperations(project, [
			{ type: "add_node", id: "first", kind: "image-generator" },
			{ type: "add_node", id: "last", kind: "image-generator" },
			{ type: "add_node", id: "video", kind: "video-generator" },
			{
				type: "configure_generation",
				targetNodeId: "video",
				generationIntent: "interpolate-frames",
				sources: [{ sourceNodeId: "first" }, { sourceNodeId: "last" }],
			},
		], [FRAME_VIDEO_MODEL]);

		const next = applyContentProjectCommands(project, commands);
		expect(next.graph.edges).toEqual([
			expect.objectContaining({ source: "first", target: "video", role: "firstFrame" }),
			expect.objectContaining({ source: "last", target: "video", role: "lastFrame" }),
		]);
	});

	it("turns legacy video target inputs into an actionable generation-plan error", () => {
		const project = applyContentProjectCommands(createContentProject("C:/project"), [
			{ type: "node.add", node: { id: "image", kind: "image-generator", position: { x: 0, y: 0 } } },
			{ type: "node.add", node: { id: "video", kind: "video-generator", position: { x: 400, y: 0 } } },
		]);

		try {
			parseContentAgentOperations(project, [
				{ type: "connect_nodes", source: "image", target: "video", targetInput: "startImages" },
			]);
			expect.unreachable("expected semantic connection error");
		} catch (error) {
			expect(error).toMatchObject({
				code: "generation-semantic-connection-required",
				retryable: true,
				details: {
					targetNodeId: "video",
					requiredOperation: "configure_generation",
					suggestedSource: { sourceNodeId: "image" },
				},
			});
		}
	});

	it("explains when configure_generation uses a source image as its target", () => {
		const project = applyContentProjectCommands(createContentProject("C:/project"), [
			{ type: "node.add", node: { id: "product-image", kind: "image-generator", position: { x: 0, y: 0 } } },
			{ type: "node.add", node: { id: "product-video", kind: "video-generator", position: { x: 400, y: 0 } } },
		]);

		try {
			parseContentAgentOperations(project, [
				{
					type: "configure_generation",
					targetNodeId: "product-image",
					generationIntent: "animate-still",
					sources: [{ sourceNodeId: "product-image" }],
				},
			], [FRAME_VIDEO_MODEL]);
			expect.unreachable("expected invalid generation target error");
		} catch (error) {
			expect(error).toMatchObject({
				code: "generation-intent-target-invalid",
				retryable: true,
				details: {
					targetNodeId: "product-image",
					targetKind: "image-generator",
					videoGeneratorNodeIds: ["product-video"],
					suggestedSource: { sourceNodeId: "product-image" },
				},
			});
		}
	});

	it("keeps the unambiguous generated-image reference role explicit", () => {
		const project = applyContentProjectCommands(createContentProject("C:/project"), [
			{ type: "node.add", node: { id: "source", kind: "image-generator", position: { x: 0, y: 0 } } },
			{ type: "node.add", node: { id: "target", kind: "image-generator", position: { x: 400, y: 0 } } },
		]);

		const commands = parseContentAgentOperations(project, [
			{ type: "connect_nodes", source: "source", target: "target", targetInput: "referenceImages" },
		]);

		expect(commands).toEqual([
			expect.objectContaining({ type: "edge.connect", targetHandle: "reference", role: "referenceImages" }),
		]);
	});

	it("rejects operations outside the agent workflow surface", () => {
		const project = createContentProject("C:/project");
		expect(CONTENT_AGENT_OPERATION_SCHEMA.items.properties.type.enum).not.toContain("add_timeline_clip");
		expect(() =>
			parseContentAgentOperations(project, [
				{ type: "add_timeline_clip", nodeId: "source", start: 0, duration: 5 },
			]),
		).toThrow("unsupported operation type: add_timeline_clip");
	});
});
