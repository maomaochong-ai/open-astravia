import { describe, expect, it } from "vitest";
import { createDefaultContentNodeData } from "../src/node/definitions";
import { createContentSelectionPromptAttachment } from "../src/plugin/selection-prompt-context";
import { createContentProject } from "../src/project/types";

describe("content selection prompt context", () => {
	it("projects selected nodes into a semantic context without private asset storage", () => {
		const project = createContentProject("C:/project", "2026-08-07T00:00:00.000Z");
		project.revision = 7;
		project.graph.nodes = [
			{
				id: "prompt-1",
				kind: "prompt",
				name: "Opening prompt",
				purpose: "Describe the opening frame",
				position: { x: 100, y: 200 },
				status: "idle",
				data: {
					...createDefaultContentNodeData("prompt"),
					promptDocument: {
						version: 1,
						segments: [
							{ type: "text", text: "Use this reference" },
							{ type: "asset-reference", bindingId: "binding-1" },
						],
					},
					inputs: [{ id: "binding-1", assetId: "asset-1", slotId: "reference" }],
				},
			},
			{
				id: "image-1",
				kind: "image-generator",
				name: "Hero image",
				position: { x: 500, y: 200 },
				status: "idle",
				data: createDefaultContentNodeData("image-generator"),
			},
		];
		project.graph.edges = [
			{
				id: "edge-1",
				source: "prompt-1",
				target: "image-1",
				sourceHandle: "prompt",
				targetHandle: "prompt",
			},
		];
		project.assets = [
			{
				id: "asset-1",
				blobId: "private-blob-id",
				kind: "image",
				name: "reference.png",
				mimeType: "image/png",
				width: 1024,
				height: 768,
				createdAt: "2026-08-07T00:00:00.000Z",
			},
		];

		const attachment = createContentSelectionPromptAttachment(project, ["prompt-1"], "Opening prompt", ["Opening prompt"]);
		const payload = attachment?.context?.payload;

		expect(attachment?.lifecycle).toBe("sticky");
		expect(payload?.selection.nodeIds).toEqual(["prompt-1"]);
		expect(payload?.selection.nodes).toHaveLength(1);
		expect(payload?.selection.connections).toEqual([
			{
				id: "edge-1",
				fromNodeId: "prompt-1",
				toNodeId: "image-1",
				fromOutput: "prompt",
				toInput: "prompt",
			},
		]);
		expect(payload?.selection.assets).toEqual([
			{
				id: "asset-1",
				name: "reference.png",
				type: "image",
				origin: { type: "user-imported" },
				metadata: { mimeType: "image/png", width: 1024, height: 768 },
			},
		]);
		expect(JSON.stringify(payload)).not.toContain("private-blob-id");
		expect(JSON.stringify(payload)).not.toContain('"x":100');
	});

	it("does not attach an empty selection", () => {
		expect(createContentSelectionPromptAttachment(createContentProject(null), [], "None", [])).toBeNull();
	});
});
