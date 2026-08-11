import { describe, expect, it } from "vitest";
import { listContentKeyframeReferences } from "../src/node/keyframe-sources";
import { createContentProject } from "../src/project/types";

describe("content keyframe sources", () => {
	it("resolves fixed project assets and dynamic generated-node outputs by role", () => {
		const project = createContentProject("C:/project");
		project.assets.push(
			{
				id: "project-frame",
				blobId: "project-frame",
				kind: "image",
				name: "Project frame",
				mimeType: "image/png",
				createdAt: "2026-01-01T00:00:00.000Z",
			},
			{
				id: "generated-frame",
				filePath: "output/generated-frame.png",
				kind: "image",
				name: "Generated frame",
				mimeType: "image/png",
				createdAt: "2026-01-01T00:00:00.000Z",
			},
			{
				id: "regenerated-frame",
				filePath: "output/regenerated-frame.png",
				kind: "image",
				name: "Regenerated frame",
				mimeType: "image/png",
				createdAt: "2026-01-02T00:00:00.000Z",
			},
		);
		project.graph.nodes.push(
			{
				id: "upstream-image",
				kind: "image-generator",
				position: { x: 0, y: 0 },
				status: "succeeded",
				data: { assetId: "generated-frame" },
			},
			{
				id: "video",
				kind: "video-generator",
				position: { x: 300, y: 0 },
				status: "idle",
				data: {
					inputs: [{ id: "last-binding", assetId: "project-frame", slotId: "lastFrame" }],
				},
			},
		);
		project.graph.edges.push({
			id: "first-edge",
			source: "upstream-image",
			target: "video",
			role: "firstFrame",
		});

		expect(listContentKeyframeReferences(project, "video")).toMatchObject([
			{ slotId: "lastFrame", asset: { id: "project-frame" }, origin: "binding" },
			{
				slotId: "firstFrame",
				asset: { id: "generated-frame" },
				sourceNodeId: "upstream-image",
				origin: "node-output",
			},
		]);

		const upstream = project.graph.nodes.find((node) => node.id === "upstream-image");
		if (!upstream) throw new Error("upstream image fixture is missing");
		upstream.data.assetId = "regenerated-frame";
		expect(listContentKeyframeReferences(project, "video")).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					slotId: "firstFrame",
					asset: expect.objectContaining({ id: "regenerated-frame" }),
				}),
			]),
		);
	});
});
