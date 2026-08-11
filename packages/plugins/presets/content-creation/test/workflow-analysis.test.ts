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
			expect.arrayContaining([expect.objectContaining({ code: "asset-connection-unbound", nodeId: "image" })]),
		);
	});
});
