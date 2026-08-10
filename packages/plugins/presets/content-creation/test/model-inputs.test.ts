import { describe, expect, it } from "vitest";
import {
	assignContentReferenceSlots,
	listAcceptedReferenceKinds,
	resolveContentGenerationMode,
} from "../src/generation/model-inputs";
import { REPLICATE_IMAGE_MODELS, REPLICATE_VIDEO_MODELS } from "../src/generation/model-catalog";
import type { ContentModelDescriptor } from "../src/generation/types";

describe("content model input compatibility", () => {
	it("selects text-to-image without references and image-to-image with references", () => {
		const model = REPLICATE_IMAGE_MODELS.find((candidate) => candidate.modelId === "bytedance/seedream-4.5");
		expect(model).toBeDefined();
		if (!model) return;

		expect(resolveContentGenerationMode(model, []).mode?.id).toBe("text-to-image");
		expect(resolveContentGenerationMode(model, [{ slotId: "referenceImages", kind: "image" }]).mode?.id).toBe(
			"image-to-image",
		);
	});

	it("requires a video for Kling O1 while allowing optional image references", () => {
		const model = REPLICATE_VIDEO_MODELS.find((candidate) => candidate.modelId === "kwaivgi/kling-o1");
		expect(model).toBeDefined();
		if (!model) return;

		expect(resolveContentGenerationMode(model, []).reason).toBe("missing-required-input");
		expect(
			resolveContentGenerationMode(model, [
				{ slotId: "referenceImages", kind: "image" },
				{ slotId: "referenceVideo", kind: "video" },
			]).mode?.id,
		).toBe("video-to-video");
	});

	it("keeps unsupported audio visible to the asset system but unavailable to current media models", () => {
		const model = REPLICATE_IMAGE_MODELS.find((candidate) => candidate.modelId === "bytedance/seedream-4.5");
		expect(model).toBeDefined();
		if (!model) return;

		expect(listAcceptedReferenceKinds(model, [])).not.toContain("audio");
		expect(resolveContentGenerationMode(model, [{ slotId: "referenceImages", kind: "audio" }]).reason).toBe(
			"unsupported-kind",
		);
	});

	it("assigns model-agnostic prompt references to the selected model input slots", () => {
		const model = REPLICATE_IMAGE_MODELS.find((candidate) => candidate.modelId === "bytedance/seedream-4.5");
		expect(model).toBeDefined();
		if (!model) return;

		const assignment = assignContentReferenceSlots(model, [], ["image"]);
		expect(assignment.mode?.id).toBe("image-to-image");
		expect(assignment.assignedSlotIds).toEqual(["referenceImages"]);
		expect(assignment.references).toEqual([{ slotId: "referenceImages", kind: "image" }]);
	});

	it("keeps frame and omni-reference assignment strict after the user selects a method", () => {
		const model: ContentModelDescriptor = {
			providerId: "host-media",
			modelId: "minimax-h3",
			displayName: "MiniMax H3",
			outputKind: "video",
			aspectRatios: ["16:9", "9:16"],
			modes: [
				{
					id: "image-to-video",
					inputs: [
						{ id: "firstFrame", accepts: ["image"], minItems: 0, maxItems: 1 },
						{ id: "lastFrame", accepts: ["image"], minItems: 0, maxItems: 1 },
					],
					minTotalItems: 1,
				},
				{
					id: "reference-to-video",
					inputs: [
						{ id: "referenceImages", accepts: ["image"], minItems: 0, maxItems: 9 },
						{ id: "referenceVideos", accepts: ["video"], minItems: 0, maxItems: 3 },
						{ id: "referenceAudios", accepts: ["audio"], minItems: 0, maxItems: 3 },
					],
					minTotalItems: 1,
					maxTotalItems: 12,
				},
			],
		};

		expect(assignContentReferenceSlots(model, [], ["image"], "image-to-video", true).assignedSlotIds).toEqual([
			"firstFrame",
		]);
		expect(
			assignContentReferenceSlots(model, [], ["video", "audio"], "reference-to-video", true),
		).toMatchObject({
			mode: { id: "reference-to-video" },
			assignedSlotIds: ["referenceVideos", "referenceAudios"],
		});
		expect(resolveContentGenerationMode(model, [], "image-to-video", true).reason).toBe("missing-required-input");
	});
});
