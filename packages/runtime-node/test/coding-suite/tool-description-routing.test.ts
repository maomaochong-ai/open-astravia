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
		// glob never names `find`: the fallback is unregistered by default, and a description
		// that routes to an invisible tool is what `tool-description-references` guards against.
		expect(GLOB_TOOL_DESCRIPTION).not.toContain("`find`");
		expect(FIND_TOOL_DESCRIPTION).toContain("Deferred high-volume");
		expect(FIND_TOOL_DESCRIPTION).toContain("For ordinary file matching, use `glob` instead");
	});

	it("splits file and directory matching between glob and find", () => {
		expect(GLOB_TOOL_DESCRIPTION).toContain("Results are FILES only, never directories");
		expect(GLOB_TOOL_DESCRIPTION).toContain("most recently modified first");
		expect(FIND_TOOL_DESCRIPTION).toContain("directory paths, which `glob` never returns");
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
