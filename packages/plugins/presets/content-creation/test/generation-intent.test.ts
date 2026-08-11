import { describe, expect, it } from "vitest";
import {
	ContentGenerationIntentError,
	planContentVideoGeneration,
} from "../src/generation/generation-intent";
import type { ContentModelDescriptor } from "../src/generation/types";
import { applyContentProjectCommands } from "../src/project/commands";
import { createContentProject } from "../src/project/types";

const FRAME_MODEL: ContentModelDescriptor = {
	providerId: "host-media",
	modelId: "frame-video",
	displayName: "Frame video",
	outputKind: "video",
	aspectRatios: ["16:9"],
	modes: [
		{ id: "text-to-video", inputs: [] },
		{
			id: "image-to-video",
			inputs: [
				{ id: "firstFrame", accepts: ["image"], minItems: 0, maxItems: 1 },
				{ id: "lastFrame", accepts: ["image"], minItems: 0, maxItems: 1 },
			],
			minTotalItems: 1,
			maxTotalItems: 2,
		},
		{
			id: "reference-to-video",
			inputs: [
				{ id: "referenceImages", accepts: ["image"], minItems: 0, maxItems: 4 },
				{ id: "referenceVideos", accepts: ["video"], minItems: 0, maxItems: 1 },
			],
			minTotalItems: 1,
		},
	],
};

function projectWithGenerators() {
	return applyContentProjectCommands(createContentProject("C:/project"), [
		{ type: "node.add", node: { id: "first", kind: "image-generator", position: { x: 0, y: 0 } } },
		{ type: "node.add", node: { id: "last", kind: "image-generator", position: { x: 0, y: 300 } } },
		{ type: "node.add", node: { id: "video", kind: "video-generator", position: { x: 500, y: 0 } } },
	]);
}

describe("content generation intent planning", () => {
	it("plans generated image outputs as distinct first and last frames", () => {
		const plan = planContentVideoGeneration(
			projectWithGenerators(),
			"video",
			"interpolate-frames",
			[{ sourceNodeId: "first" }, { sourceNodeId: "last" }],
			[FRAME_MODEL],
		);

		expect(plan).toMatchObject({
			intent: "interpolate-frames",
			modeId: "image-to-video",
			bindings: [
				{ sourceNodeId: "first", assetIds: [], slotId: "firstFrame", targetHandle: "image" },
				{ sourceNodeId: "last", assetIds: [], slotId: "lastFrame", targetHandle: "image" },
			],
		});
	});

	it("binds selected asset-node images as references instead of a bare edge", () => {
		const project = applyContentProjectCommands(projectWithGenerators(), [
			{
				type: "asset.add",
				asset: { id: "hero", kind: "image", name: "hero", mimeType: "image/png", createdAt: "now" },
			},
			{
				type: "node.add",
				node: { id: "assets", kind: "asset", position: { x: 0, y: 600 }, data: { assetIds: ["hero"] } },
			},
		]);

		const plan = planContentVideoGeneration(
			project,
			"video",
			"reference-guided",
			[{ sourceNodeId: "assets", assetIds: ["hero"] }],
			[FRAME_MODEL],
		);

		expect(plan).toMatchObject({
			modeId: "reference-to-video",
			bindings: [{ sourceNodeId: "assets", assetIds: ["hero"], slotId: "referenceImages" }],
		});
	});

	it("does not pretend a single-frame model supports first/last interpolation", () => {
		const singleFrameModel: ContentModelDescriptor = {
			...FRAME_MODEL,
			modelId: "single-frame",
			modes: [{ id: "image-to-video", inputs: [{ id: "referenceImages", accepts: ["image"], minItems: 1, maxItems: 1 }] }],
		};

		expect(() =>
			planContentVideoGeneration(
				projectWithGenerators(),
				"video",
				"interpolate-frames",
				[{ sourceNodeId: "first" }, { sourceNodeId: "last" }],
				[singleFrameModel],
			),
		).toThrow(ContentGenerationIntentError);
	});

	it("rejects contradictory explicit frame roles instead of silently reassigning them", () => {
		expect(() =>
			planContentVideoGeneration(
				projectWithGenerators(),
				"video",
				"interpolate-frames",
				[
					{ sourceNodeId: "first", role: "firstFrame" },
					{ sourceNodeId: "last", role: "firstFrame" },
				],
				[FRAME_MODEL],
			),
		).toThrow("unique firstFrame and lastFrame roles");
	});

	it("directs an empty animate-still plan to the local asset bridge", () => {
		try {
			planContentVideoGeneration(projectWithGenerators(), "video", "animate-still", [], [FRAME_MODEL]);
			throw new Error("expected generation planning to fail");
		} catch (error) {
			expect(error).toMatchObject({
				code: "generation-source-required",
				retryable: true,
				details: {
					intent: "animate-still",
					requiredKind: "image",
					requiredCount: 1,
					suggestedTool: "content_creation_assets",
				},
			} satisfies Partial<ContentGenerationIntentError>);
		}
	});
});
