import { describe, expect, it } from "vitest";
import {
	EXTRACT_TEXT_FROM_PDF_TOOL_DESCRIPTION,
	FIND_TOOL_DESCRIPTION,
	GLOB_TOOL_DESCRIPTION,
	READ_TOOL_DESCRIPTION,
} from "../../src/coding/index.js";

describe("coding tool description routing", () => {
	it("makes glob the primary path matcher and find a non-duplicative fallback", () => {
		expect(GLOB_TOOL_DESCRIPTION).toContain("Primary tool");
		expect(GLOB_TOOL_DESCRIPTION).toContain("Do not also call `find` for the same search");
		expect(FIND_TOOL_DESCRIPTION).toContain("Deferred high-volume");
		expect(FIND_TOOL_DESCRIPTION).toContain("For ordinary file or directory name matching, use `glob` instead");
	});

	it("routes every PDF text request to extraction and visual judgment to rendering", () => {
		expect(READ_TOOL_DESCRIPTION).toContain("PDF text: use `extract_text_from_pdf`");
		expect(READ_TOOL_DESCRIPTION).toContain("PDF visual judgment");
		expect(EXTRACT_TEXT_FROM_PDF_TOOL_DESCRIPTION).toContain("textual content from any PDF");
		expect(EXTRACT_TEXT_FROM_PDF_TOOL_DESCRIPTION).not.toContain("`read` plus a PDF-text-extracting tool");
	});

	it("does not invent fixed skill names for binary document routing", () => {
		expect(READ_TOOL_DESCRIPTION).toContain("exact skill name shown in the current available-skills list");
		expect(READ_TOOL_DESCRIPTION).not.toContain('invoke_skill(name="docx")');
		expect(READ_TOOL_DESCRIPTION).not.toContain('invoke_skill(name="xlsx")');
	});
});
