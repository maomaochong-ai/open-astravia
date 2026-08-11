import { describe, expect, it } from "vitest";
import { resolveSupportedModelOption } from "../src/generation/model-options";

describe("resolveSupportedModelOption", () => {
	it("preserves a value supported by the selected model", () => {
		expect(resolveSupportedModelOption("720p", ["480p", "720p"])).toBe("720p");
	});

	it("falls back to the selected model's first option", () => {
		expect(resolveSupportedModelOption("1080p", ["480p", "720p"])).toBe("480p");
	});

	it("drops stale values when the selected model does not expose that option", () => {
		expect(resolveSupportedModelOption("720p", [])).toBeUndefined();
	});
});
