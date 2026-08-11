import { describe, expect, it } from "vitest";
import { resolveContentAspectRatio } from "../src/generation/aspect-ratio";

const VIDEO_RATIOS = ["1:1", "2:3", "3:2", "3:4", "4:3", "9:16", "16:9", "21:9"];

describe("resolveContentAspectRatio", () => {
	it("follows the first portrait image for automatic video generation", () => {
		expect(
			resolveContentAspectRatio({
				outputKind: "video",
				supportedAspectRatios: VIDEO_RATIOS,
				references: [{ kind: "image", width: 1080, height: 1920 }],
			}),
		).toBe("9:16");
	});

	it("selects the closest supported ratio without distorting orientation", () => {
		expect(
			resolveContentAspectRatio({
				outputKind: "video",
				supportedAspectRatios: VIDEO_RATIOS,
				references: [{ kind: "image", width: 1200, height: 1600 }],
			}),
		).toBe("3:4");
	});

	it("preserves an explicit user ratio", () => {
		expect(
			resolveContentAspectRatio({
				outputKind: "video",
				explicitAspectRatio: "16:9",
				supportedAspectRatios: VIDEO_RATIOS,
				references: [{ kind: "image", width: 1080, height: 1920 }],
			}),
		).toBe("16:9");
	});

	it("falls back to landscape video when image dimensions are unavailable", () => {
		expect(
			resolveContentAspectRatio({
				outputKind: "video",
				supportedAspectRatios: VIDEO_RATIOS,
				references: [{ kind: "image" }],
			}),
		).toBe("16:9");
	});
});
