import { describe, expect, it } from "vitest";
import {
	listConnectedPromptSources,
	resolveConnectedPromptSource,
	resolveConnectedPromptSources,
	resolveContentPrompt,
} from "../src/node/prompt-sources";
import { createContentProject } from "../src/project/types";

describe("connected prompt sources", () => {
	it("keeps prompt text and media references together while their source nodes remain connected", () => {
		const project = createContentProject("C:/project");
		project.assets.push({
			id: "image",
			blobId: "image",
			kind: "image",
			name: "Mood",
			mimeType: "image/png",
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

	it("uses structured token order instead of parsing asset names from prompt text", () => {
		const project = createContentProject("C:/project");
		project.assets.push(
			{
				id: "first",
				blobId: "first",
				kind: "image",
				name: "@not-a-reference",
				mimeType: "image/png",
				createdAt: "2026-01-01T00:00:00.000Z",
			},
			{
				id: "second",
				blobId: "second",
				kind: "image",
				name: "Second",
				mimeType: "image/png",
				createdAt: "2026-01-01T00:00:00.000Z",
			},
		);
		project.graph.nodes.push(
			{
				id: "prompt",
				kind: "prompt",
				position: { x: 0, y: 0 },
				status: "idle",
				data: {
					prompt: "Mention @not-a-reference as ordinary text",
					promptDocument: {
						version: 1,
						segments: [
							{ type: "asset-reference", bindingId: "second-binding" },
							{ type: "text", text: "Mention @not-a-reference as ordinary text" },
						],
					},
					inputs: [
						{ id: "first-binding", assetId: "first", slotId: "promptReferences" },
						{ id: "second-binding", assetId: "second", slotId: "promptReferences" },
					],
				},
			},
			{
				id: "generator",
				kind: "image-generator",
				position: { x: 300, y: 0 },
				status: "idle",
				data: {},
			},
		);
		project.graph.edges.push({
			id: "prompt-edge",
			source: "prompt",
			target: "generator",
			targetHandle: "prompt",
		});

		const source = listConnectedPromptSources(project, "generator")[0];
		expect(source?.references.map(({ asset }) => asset.id)).toEqual(["second"]);
		expect(source?.prompt).toBe("Mention @not-a-reference as ordinary text");
	});

	it("mixes local text with multiple connected prompt tokens in document order", () => {
		const sources = [
			{ nodeId: "first", prompt: "a quiet forest", references: [] },
			{ nodeId: "second", prompt: "soft morning light", references: [] },
		];
		const data = {
			promptDocument: {
				version: 1 as const,
				segments: [
					{ type: "text" as const, text: "Create " },
					{ type: "prompt-reference" as const, sourceNodeId: "first" },
					{ type: "text" as const, text: " with " },
					{ type: "prompt-reference" as const, sourceNodeId: "second" },
				],
			},
		};

		expect(resolveConnectedPromptSources(sources, data).map(({ nodeId }) => nodeId)).toEqual([
			"first",
			"second",
		]);
		expect(resolveContentPrompt(sources, data)).toBe(
			"Create a quiet forest with soft morning light",
		);
	});

	it("serializes omni-reference mentions to MiniMax H3 media tokens by kind", () => {
		const data = {
			promptDocument: {
				version: 1 as const,
				segments: [
					{ type: "text" as const, text: "Keep " },
					{ type: "asset-reference" as const, bindingId: "picture-2" },
					{ type: "text" as const, text: " moving like " },
					{ type: "asset-reference" as const, bindingId: "video-1" },
					{ type: "text" as const, text: " with " },
					{ type: "asset-reference" as const, bindingId: "audio-1" },
				],
			},
			inputs: [
				{ id: "picture-1", assetId: "image-1", slotId: "referenceImages" },
				{ id: "picture-2", assetId: "image-2", slotId: "referenceImages" },
				{ id: "video-1", assetId: "video-1", slotId: "referenceVideos" },
				{ id: "audio-1", assetId: "audio-1", slotId: "referenceAudios" },
			],
		};

		expect(resolveContentPrompt([], data)).toBe("Keep <Picture 2> moving like <Video 1> with <Audio 1>");
	});
});
