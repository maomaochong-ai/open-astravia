import { describe, expect, it } from "vitest";
import { EDIT_IMAGE_TOOL_DESCRIPTION, GENERATE_IMAGE_TOOL_DESCRIPTION } from "../src/tool-descriptions";

describe("image tool descriptions", () => {
	it.each([GENERATE_IMAGE_TOOL_DESCRIPTION, EDIT_IMAGE_TOOL_DESCRIPTION])(
		"defines negative routing for a billed operation",
		(description) => {
			expect(description).toMatch(/\bDo NOT use\b/);
			expect(description).toContain("Every call is billed");
		},
	);

	it("routes multilingual requests for new standalone visual assets to generate_image", () => {
		expect(GENERATE_IMAGE_TOOL_DESCRIPTION).toContain("brief requests in any language");
		expect(GENERATE_IMAGE_TOOL_DESCRIPTION).toContain("transparent-background asset");
		expect(GENERATE_IMAGE_TOOL_DESCRIPTION).toContain("game asset");
		expect(GENERATE_IMAGE_TOOL_DESCRIPTION).toContain("character art");
		expect(GENERATE_IMAGE_TOOL_DESCRIPTION).toContain("item art");
		expect(GENERATE_IMAGE_TOOL_DESCRIPTION).toContain("sticker");
		expect(GENERATE_IMAGE_TOOL_DESCRIPTION).toContain("generated reference image");
		expect(GENERATE_IMAGE_TOOL_DESCRIPTION).toContain("actual visual deliverable");
		expect(GENERATE_IMAGE_TOOL_DESCRIPTION).toContain("do not only describe a prompt in text");
	});

	it("excludes implementation and deterministic UI design work from generate_image", () => {
		expect(GENERATE_IMAGE_TOOL_DESCRIPTION).toContain("website");
		expect(GENERATE_IMAGE_TOOL_DESCRIPTION).toContain("UI design");
		expect(GENERATE_IMAGE_TOOL_DESCRIPTION).toContain("UI rendering");
		expect(GENERATE_IMAGE_TOOL_DESCRIPTION).toContain("HTML/CSS mockup");
		expect(GENERATE_IMAGE_TOOL_DESCRIPTION).toContain("Implement those with code");
	});

	it("makes generate prompt optimization the caller's responsibility", () => {
		expect(GENERATE_IMAGE_TOOL_DESCRIPTION).toContain("Before calling");
		expect(GENERATE_IMAGE_TOOL_DESCRIPTION).toContain("does not optimize it for you");
		expect(GENERATE_IMAGE_TOOL_DESCRIPTION).not.toContain("then optimize the request");
	});
});
