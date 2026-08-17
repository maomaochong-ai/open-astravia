import { describe, expect, it } from "vitest";
import { calculateH3CanvasResolution, resolveH3ResolutionPreset } from "../src/h3-resolution";

describe("MiniMax H3 resolution profiles", () => {
	it("maps the stable profile ids to pixel-budget and 2K sizing strategies", () => {
		expect(resolveH3ResolutionPreset("0_5mp").sizing).toEqual({ kind: "megapixels", value: 0.5 });
		expect(resolveH3ResolutionPreset("0_75mp").sizing).toEqual({ kind: "megapixels", value: 0.75 });
		expect(resolveH3ResolutionPreset("1mp").sizing).toEqual({ kind: "long-edge", pixels: 2048 });
	});

	it("uses the balanced profile for absent and legacy 720p values", () => {
		expect(resolveH3ResolutionPreset(undefined).id).toBe("0_75mp");
		expect(resolveH3ResolutionPreset("720p").id).toBe("0_75mp");
	});

	it("calculates the lowest tier with the model's 32-pixel alignment", () => {
		expect(
			calculateH3CanvasResolution("9:16", resolveH3ResolutionPreset("0_5mp"), {
				width: 1344,
				height: 768,
			}),
		).toEqual({
			width: 544,
			height: 960,
			megapixels: 0.5,
		});
	});

	it("keeps the 2K tier at a real 2048px long edge for landscape and portrait ratios", () => {
		const ultra = resolveH3ResolutionPreset("1mp");
		expect(calculateH3CanvasResolution("16:9 (Widescreen)", ultra, { width: 1344, height: 768 })).toEqual({
			width: 2048,
			height: 1152,
			megapixels: 2.25,
		});
		expect(calculateH3CanvasResolution("9:16", ultra, { width: 1344, height: 768 })).toEqual({
			width: 1152,
			height: 2048,
			megapixels: 2.25,
		});
	});
});
