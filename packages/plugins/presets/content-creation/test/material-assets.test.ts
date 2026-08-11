import { describe, expect, it } from "vitest";
import {
	isContentInputBindingAvailable,
	listConnectedContentAssets,
	listContentNodeAssetIds,
} from "../src/node/material-assets";
import { createContentProject } from "../src/project/types";

describe("material asset collections", () => {
	it("keeps legacy single assets while deduplicating the multi-asset collection", () => {
		expect(listContentNodeAssetIds({ assetId: "legacy", assetIds: ["legacy", "video", "audio"] })).toEqual([
			"legacy",
			"video",
			"audio",
		]);
	});

	it("exposes assets only while their material node remains connected", () => {
		const project = createContentProject("C:/project");
		project.assets.push({
			id: "image",
			blobId: "image",
			kind: "image",
			name: "Image",
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
				id: "generator",
				kind: "image-generator",
				position: { x: 300, y: 0 },
				status: "idle",
				data: {},
			},
		);
		project.graph.edges.push({ id: "edge", source: "assets", target: "generator" });

		expect(listConnectedContentAssets(project, "generator")).toMatchObject([
			{ sourceNodeId: "assets", asset: { id: "image" } },
		]);
		expect(
			isContentInputBindingAvailable(project, "generator", {
				id: "binding",
				assetId: "image",
				slotId: "referenceImages",
				sourceNodeId: "assets",
			}),
		).toBe(true);

		project.graph.edges = [];
		expect(listConnectedContentAssets(project, "generator")).toEqual([]);
		expect(
			isContentInputBindingAvailable(project, "generator", {
				id: "binding",
				assetId: "image",
				slotId: "referenceImages",
				sourceNodeId: "assets",
			}),
		).toBe(false);
	});

	it("exposes generated outputs with their semantic edge role", () => {
		const project = createContentProject("C:/project");
		project.assets.push({
			id: "generated-image",
			filePath: "output/generated.png",
			kind: "image",
			name: "Generated image",
			mimeType: "image/png",
			createdAt: "2026-01-01T00:00:00.000Z",
		});
		project.graph.nodes.push(
			{
				id: "image-generator",
				kind: "image-generator",
				position: { x: 0, y: 0 },
				status: "succeeded",
				data: { assetId: "generated-image" },
			},
			{
				id: "video-generator",
				kind: "video-generator",
				position: { x: 300, y: 0 },
				status: "idle",
				data: {},
			},
		);
		project.graph.edges.push({
			id: "first-frame-edge",
			source: "image-generator",
			target: "video-generator",
			role: "firstFrame",
		});

		expect(listConnectedContentAssets(project, "video-generator")).toMatchObject([
			{
				sourceNodeId: "image-generator",
				edgeId: "first-frame-edge",
				role: "firstFrame",
				asset: { id: "generated-image" },
			},
		]);
	});
});
