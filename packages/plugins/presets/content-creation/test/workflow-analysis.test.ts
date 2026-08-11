import { describe, expect, it } from "vitest";
import type { ContentModelDescriptor } from "../src/generation/types";
import { analyzeContentWorkflow } from "../src/agent/workflow-analysis";
import { applyContentProjectCommands } from "../src/project/commands";
import { createContentProject } from "../src/project/types";

const IMAGE_MODEL: ContentModelDescriptor = {
	providerId: "provider",
	modelId: "image",
	displayName: "Image",
	outputKind: "image",
	modes: [{ id: "text-to-image", inputs: [] }],
	aspectRatios: ["1:1"],
};

const FRAME_VIDEO_MODEL: ContentModelDescriptor = {
	providerId: "provider",
	modelId: "video",
	displayName: "Video",
	outputKind: "video",
	modes: [{ id: "image-to-video", inputs: [{ id: "firstFrame", accepts: ["image"], minItems: 1, maxItems: 1 }] }],
	aspectRatios: ["16:9"],
};

describe("content workflow analysis", () => {
	it("reports explicit semantic connections and a ready workflow", () => {
		const project = applyContentProjectCommands(createContentProject("C:/project"), [
			{
				type: "node.add",
				node: { id: "prompt", kind: "prompt", position: { x: 0, y: 0 }, data: { prompt: "Product" } },
			},
			{ type: "node.add", node: { id: "image", kind: "image-generator", position: { x: 400, y: 0 } } },
			{ type: "node.add", node: { id: "output", kind: "output", position: { x: 800, y: 0 } } },
			{ type: "edge.connect", source: "prompt", target: "image" },
			{ type: "edge.connect", source: "image", target: "output" },
			{
				type: "workflow.update",
				workflow: {
					deliverables: [{ type: "image", fromNode: "output", description: "Final image" }],
				},
			},
		]);

		const analysis = analyzeContentWorkflow(project, [IMAGE_MODEL]);
		expect(analysis.status).toBe("ready");
		expect(analysis.connections).toEqual([
			expect.objectContaining({ fromNodeId: "prompt", fromOutput: "prompt", toNodeId: "image", toInput: "promptSources" }),
			expect.objectContaining({ fromNodeId: "image", fromOutput: "image", toNodeId: "output", toInput: "contentSources" }),
		]);
		expect(analysis.orphanNodeIds).toEqual([]);
	});

	it("marks node-only workflows incomplete and explains orphan nodes", () => {
		const project = applyContentProjectCommands(createContentProject("C:/project"), [
			{ type: "node.add", node: { id: "prompt", kind: "prompt", position: { x: 0, y: 0 } } },
			{ type: "node.add", node: { id: "image", kind: "image-generator", position: { x: 400, y: 0 } } },
		]);

		const analysis = analyzeContentWorkflow(project, [IMAGE_MODEL]);
		expect(analysis.status).toBe("incomplete");
		expect(analysis.orphanNodeIds).toEqual(["prompt", "image"]);
		expect(analysis.issues.map((issue) => issue.code)).toContain("orphan-node");
	});

	it("reports an asset edge without selected bindings", () => {
		const project = applyContentProjectCommands(createContentProject("C:/project"), [
			{ type: "node.add", node: { id: "assets", kind: "asset", position: { x: 0, y: 0 } } },
			{ type: "node.add", node: { id: "image", kind: "image-generator", position: { x: 400, y: 0 } } },
			{ type: "edge.connect", source: "assets", target: "image" },
		]);

		expect(analyzeContentWorkflow(project, [IMAGE_MODEL]).issues).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ code: "asset-connection-unbound", severity: "error", nodeId: "image" }),
			]),
		);
	});

	it("rejects a generated media dependency whose business role is missing", () => {
		const project = applyContentProjectCommands(createContentProject("C:/project"), [
			{ type: "node.add", node: { id: "image", kind: "image-generator", position: { x: 0, y: 0 }, data: { prompt: "hero" } } },
			{ type: "node.add", node: { id: "video", kind: "video-generator", position: { x: 400, y: 0 }, data: { prompt: "move" } } },
			{ type: "edge.connect", source: "image", target: "video", targetHandle: "image" },
		]);

		const analysis = analyzeContentWorkflow(project, [IMAGE_MODEL, FRAME_VIDEO_MODEL]);
		expect(analysis.status).toBe("incomplete");
		expect(analysis.issues).toEqual(
			expect.arrayContaining([expect.objectContaining({ code: "generation-source-role-missing", nodeId: "video" })]),
		);
	});

	it("reports configured frame roles in the semantic graph", () => {
		const project = applyContentProjectCommands(createContentProject("C:/project"), [
			{ type: "node.add", node: { id: "image", kind: "image-generator", position: { x: 0, y: 0 }, data: { prompt: "hero" } } },
			{ type: "node.add", node: { id: "video", kind: "video-generator", position: { x: 400, y: 0 }, data: { prompt: "move" } } },
			{ type: "edge.connect", source: "image", target: "video", targetHandle: "image", role: "firstFrame" },
		]);

		expect(analyzeContentWorkflow(project, [IMAGE_MODEL, FRAME_VIDEO_MODEL]).connections).toEqual([
			expect.objectContaining({ fromNodeId: "image", toNodeId: "video", toInput: "firstFrame" }),
		]);
	});

	it("reports a persisted generation binding whose asset no longer exists", () => {
		const project = applyContentProjectCommands(createContentProject("C:/project"), [
			{
				type: "node.add",
				node: {
					id: "image",
					kind: "image-generator",
					position: { x: 0, y: 0 },
					data: {
						prompt: "hero",
						inputs: [{ id: "missing", assetId: "missing", slotId: "referenceImages" }],
					},
				},
			},
		]);

		expect(analyzeContentWorkflow(project, [IMAGE_MODEL]).issues).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ code: "generation-source-asset-missing", severity: "error", nodeId: "image" }),
			]),
		);
	});
});
