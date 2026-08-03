import { describe, expect, it } from "vitest";
import {
	GEMINI_IMAGE_MODELS,
	GEMINI_VIDEO_MODELS,
	REPLICATE_IMAGE_MODELS,
	REPLICATE_VIDEO_MODELS,
} from "../src/generation/model-catalog";

describe("content generation model catalog", () => {
	it("contains the Loomic image and video model snapshots", () => {
		expect(REPLICATE_IMAGE_MODELS).toHaveLength(11);
		expect(REPLICATE_VIDEO_MODELS).toHaveLength(12);
		expect(GEMINI_IMAGE_MODELS).toHaveLength(3);
		expect(GEMINI_VIDEO_MODELS).toHaveLength(6);
	});

	it("describes models by capability instead of node-specific flags", () => {
		expect(REPLICATE_IMAGE_MODELS.every((model) => model.capabilities.includes("text-to-image"))).toBe(true);
		expect(GEMINI_VIDEO_MODELS.every((model) => model.capabilities.includes("text-to-video"))).toBe(true);
		expect(GEMINI_VIDEO_MODELS[0]?.durations).toEqual([4, 6, 8]);
		expect(REPLICATE_VIDEO_MODELS.find((model) => model.modelId === "kwaivgi/kling-o1")?.capabilities).toEqual([
			"video-to-video",
		]);
	});
});
