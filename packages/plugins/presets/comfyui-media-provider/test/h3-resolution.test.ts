import { describe, expect, it } from "vitest";
import { calculateH3Dimensions, resolveH3ResolutionPreset } from "../src/h3-resolution";

describe("MiniMax H3 resolution profiles", () => {
	it("maps the three stable profile ids to their megapixel budgets", () => {
		expect(resolveH3ResolutionPreset("0_5mp").megapixels).toBe(0.5);
		expect(resolveH3ResolutionPreset("0_75mp").megapixels).toBe(0.75);
		expect(resolveH3ResolutionPreset("1mp").megapixels).toBe(0.98);
	});

	it("uses the balanced profile for absent and legacy 720p values", () => {
		expect(resolveH3ResolutionPreset(undefined).id).toBe("0_75mp");
		expect(resolveH3ResolutionPreset("720p").id).toBe("0_75mp");
	});

	it("calculates dimensions with the model's 32-pixel alignment", () => {
		expect(calculateH3Dimensions("16:9", 0.98, { width: 1344, height: 768 })).toEqual({
			width: 1344,
			height: 768,
		});
		expect(calculateH3Dimensions("9:16", 0.5, { width: 1344, height: 768 })).toEqual({
			width: 544,
			height: 960,
		});
	});
});
