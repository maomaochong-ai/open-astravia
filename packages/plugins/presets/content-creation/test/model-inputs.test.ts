import { describe, expect, it } from "vitest";
import {
	assignContentReferenceSlots,
	listAcceptedReferenceKinds,
	resolveContentGenerationMode,
} from "../src/generation/model-inputs";
import { REPLICATE_IMAGE_MODELS, REPLICATE_VIDEO_MODELS } from "../src/generation/model-catalog";

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
});
