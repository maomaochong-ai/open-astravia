import { describe, expect, it } from "vitest";
import { NOVEL_WRITE_CHAPTER_FILE_TOOL_DESCRIPTION } from "../src/tool-description";

describe("novel_write_chapter_file description", () => {
	it("limits the specialized writer to the demo fiction workflow", () => {
		expect(NOVEL_WRITE_CHAPTER_FILE_TOOL_DESCRIPTION).toContain("Global Slot Demo fiction workflow");
		expect(NOVEL_WRITE_CHAPTER_FILE_TOOL_DESCRIPTION).toContain("instead of the general write tool only when");
		expect(NOVEL_WRITE_CHAPTER_FILE_TOOL_DESCRIPTION).toContain("automatic heading");
	});
});
