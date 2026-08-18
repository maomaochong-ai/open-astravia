import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createNodeHtmlExportFileAdapters } from "./html-export-files.js";

describe("createNodeHtmlExportFileAdapters", () => {
	const directories: string[] = [];

	afterEach(() => {
		for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
	});

	it("loads the template bundle, writes output, and delegates legacy parsing", () => {
		const directory = mkdtempSync(join(tmpdir(), "vetta-html-export-"));
		directories.push(directory);
		mkdirSync(join(directory, "vendor"));
		for (const [path, content] of [
			["template.html", "template"],
			["template.css", "css"],
			["template.js", "js"],
			[join("vendor", "marked.min.js"), "marked"],
			[join("vendor", "highlight.min.js"), "highlight"],
		] as const) {
			writeFileSync(join(directory, path), content);
		}
		const legacyPath = join(directory, "session.jsonl");
		writeFileSync(legacyPath, "legacy");
		const adapters = createNodeHtmlExportFileAdapters({
			templateDirectory: directory,
			readLegacySession: (path) => readFileSync(path, "utf8").toUpperCase(),
		});

		expect(adapters.assetsSource.load()).toEqual({
			template: "template",
			css: "css",
			js: "js",
			markedJs: "marked",
			highlightJs: "highlight",
		});
		expect(adapters.legacySessions.exists(legacyPath)).toBe(true);
		expect(adapters.legacySessions.read(legacyPath)).toBe("LEGACY");
		const outputPath = join(directory, "output.html");
		adapters.writer.write(outputPath, "<html />");
		expect(readFileSync(outputPath, "utf8")).toBe("<html />");
	});
});
