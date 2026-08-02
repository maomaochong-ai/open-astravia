import { describe, expect, it } from "vitest";
import { getContentNodeSize, parseContentAspectRatio } from "../src/domain/node-geometry";

describe("content node geometry", () => {
	it("parses supported aspect ratio notation", () => {
		expect(parseContentAspectRatio("16:9")).toBeCloseTo(16 / 9);
		expect(parseContentAspectRatio("9:16")).toBeCloseTo(9 / 16);
		expect(parseContentAspectRatio("invalid")).toBeNull();
	});

	it("fits generator placeholders into a 400 pixel canvas box", () => {
		expect(getContentNodeSize("image-generator", "1:1")).toEqual({ width: 400, height: 400 });
		expect(getContentNodeSize("video-generator", "16:9")).toEqual({ width: 400, height: 225 });
		expect(getContentNodeSize("image-generator", "9:16")).toEqual({ width: 225, height: 400 });
	});
});
