import { describe, expect, it } from "vitest";
import {
	listConnectedPromptSources,
	resolveConnectedPromptSource,
	resolveContentPrompt,
} from "../src/node/prompt-sources";
import { createContentProject } from "../src/project/types";

describe("connected prompt sources", () => {
	it("keeps prompt text and media references together while their source nodes remain connected", () => {
		const project = createContentProject("C:/project");
		project.assets.push({
			id: "image",
			kind: "image",
			name: "Mood",
			mimeType: "image/png",
			url: "vetta-media://image",
			createdAt: "2026-01-01T00:00:00.000Z",
		});
		project.graph.nodes.push(
			{
				id: "assets",
				kind: "asset",
				position: { x: 0, y: 0 },
				status: "idle",
				data: { assetIds: ["image"] },
			},
			{
				id: "prompt",
				kind: "prompt",
				position: { x: 200, y: 0 },
				status: "idle",
				data: {
					prompt: "Blue-hour lighthouse",
					inputs: [
						{
							id: "binding",
							assetId: "image",
							slotId: "promptReferences",
							sourceNodeId: "assets",
						},
					],
				},
			},
			{
				id: "generator",
				kind: "image-generator",
				position: { x: 400, y: 0 },
				status: "idle",
				data: { promptSourceNodeId: "prompt" },
			},
		);
		project.graph.edges.push(
			{ id: "asset-edge", source: "assets", target: "prompt", targetHandle: "media" },
			{ id: "prompt-edge", source: "prompt", target: "generator", targetHandle: "prompt" },
		);

		const sources = listConnectedPromptSources(project, "generator");
		expect(sources[0]).toMatchObject({
			nodeId: "prompt",
			prompt: "Blue-hour lighthouse",
			references: [{ asset: { id: "image" } }],
		});
		expect(resolveConnectedPromptSource(sources, { promptSourceNodeId: "prompt" })?.nodeId).toBe("prompt");
		expect(resolveContentPrompt(sources, { promptSourceNodeId: "prompt" })).toBe("Blue-hour lighthouse");

		project.graph.edges = project.graph.edges.filter((edge) => edge.id !== "asset-edge");
		expect(listConnectedPromptSources(project, "generator")[0]?.references).toEqual([]);
	});

	it("preserves legacy direct-prompt precedence until a source is explicitly selected", () => {
		const sources = [{ nodeId: "prompt", prompt: "Connected", references: [] }];
		expect(resolveContentPrompt(sources, { prompt: "Local" })).toBe("Local");
		expect(resolveContentPrompt(sources, { prompt: "Local", promptSourceNodeId: "prompt" })).toBe("Connected");
		expect(resolveContentPrompt(sources, { prompt: "Local", promptSourceNodeId: null })).toBe("Local");
	});
});
