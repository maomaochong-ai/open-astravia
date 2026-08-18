import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const standaloneEntrySource = readFileSync(new URL("../scripts/compile-standalone-entry.mjs", import.meta.url), "utf8");

describe("standalone CLI HTML export wiring", () => {
	it("injects file adapters so compiled --export can read and write sessions", () => {
		expect(standaloneEntrySource).toContain("createCodingAgentHtmlExportRuntime({");
		expect(standaloneEntrySource).toContain("writeFileSync(outputPath, html");
		expect(standaloneEntrySource).toContain("exists: existsSync");
		expect(standaloneEntrySource).toContain("parseCodingAgentHistoricalSessionDocument(readFileSync(path");
		expect(standaloneEntrySource).not.toContain(
			"createCodingAgentHtmlExportRuntime({ assets: { template, css, js, markedJs, highlightJs } })",
		);
	});
});
