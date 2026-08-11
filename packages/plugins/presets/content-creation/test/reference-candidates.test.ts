import { describe, expect, it } from "vitest";
import { listContentAssetReferenceCandidates } from "../src/node/reference-candidates";
import { createContentProject, type ContentAsset } from "../src/project/types";

const ASSETS: readonly ContentAsset[] = [
	{
		id: "attached",
		blobId: "attached",
		kind: "image",
		name: "Attached",
		mimeType: "image/png",
		createdAt: "2026-01-01T00:00:00.000Z",
	},
	{
		id: "connected",
		blobId: "connected",
		kind: "image",
		name: "Connected",
		mimeType: "image/png",
		createdAt: "2026-01-01T00:00:00.000Z",
	},
	{
		id: "project",
		blobId: "project",
		kind: "image",
		name: "Project",
		mimeType: "image/png",
		createdAt: "2026-01-01T00:00:00.000Z",
	},
	{
		id: "generated",
		filePath: "output/generated.png",
		kind: "image",
		name: "Generated",
		mimeType: "image/png",
		createdAt: "2026-01-01T00:00:00.000Z",
	},
];

describe("content asset reference candidates", () => {
	it("combines attached, connected, and project assets without duplicates", () => {
		const project = createContentProject("C:/project");
		project.assets.push(...structuredClone(ASSETS));
		project.graph.nodes.push(
			{
				id: "materials",
				kind: "asset",
				position: { x: 0, y: 0 },
				status: "idle",
				data: { assetIds: ["connected"] },
			},
			{
				id: "prompt",
				kind: "prompt",
				position: { x: 300, y: 0 },
				status: "idle",
				data: {
					inputs: [{ id: "binding", assetId: "attached", slotId: "promptReferences" }],
				},
			},
			{
				id: "image-generator",
				kind: "image-generator",
				position: { x: 0, y: 300 },
				status: "succeeded",
				data: { assetId: "generated" },
			},
		);
		project.graph.edges.push(
			{ id: "asset-edge", source: "materials", target: "prompt" },
			{ id: "generated-edge", source: "image-generator", target: "prompt" },
		);

		expect(
			listContentAssetReferenceCandidates(project, "prompt").map(({ asset, origin }) => ({
				id: asset.id,
				origin,
			})),
		).toEqual([
			{ id: "attached", origin: "attached" },
			{ id: "connected", origin: "connected" },
			{ id: "generated", origin: "connected" },
			{ id: "project", origin: "project" },
		]);
	});
});
