import { describe, expect, it } from "vitest";
import { EDIT_IMAGE_TOOL_DESCRIPTION, GENERATE_IMAGE_TOOL_DESCRIPTION } from "../src/tool-descriptions";

describe("image tool descriptions", () => {
	it.each([GENERATE_IMAGE_TOOL_DESCRIPTION, EDIT_IMAGE_TOOL_DESCRIPTION])(
		"defines positive and negative routing for a billed operation",
		(description) => {
			expect(description).toMatch(/\bDo NOT use\b/);
			expect(description).toMatch(/\bOnly for\b/);
		},
	);

	it("makes generate prompt optimization the caller's responsibility", () => {
		expect(GENERATE_IMAGE_TOOL_DESCRIPTION).toContain("Before calling");
		expect(GENERATE_IMAGE_TOOL_DESCRIPTION).toContain("does not optimize it for you");
		expect(GENERATE_IMAGE_TOOL_DESCRIPTION).not.toContain("then optimize the request");
	});
});
