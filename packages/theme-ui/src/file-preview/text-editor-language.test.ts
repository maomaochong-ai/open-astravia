import { describe, expect, test } from "vitest";
import {
	getTextEditorLanguageExtension,
	getTextEditorLanguageId,
	normalizeFileExtension,
} from "./text-editor-language";

describe("normalizeFileExtension", () => {
	test("accepts bare extensions and filenames", () => {
		expect(normalizeFileExtension("html")).toBe("html");
		expect(normalizeFileExtension("HTML")).toBe("html");
		expect(normalizeFileExtension("index.html")).toBe("html");
		expect(normalizeFileExtension("Index.HTML")).toBe("html");
	});

	test("uses the last path segment only", () => {
		expect(normalizeFileExtension("C:/work/app.v2/page.html")).toBe("html");
		expect(normalizeFileExtension("C:\\work\\app.v2\\page.htm")).toBe("htm");
	});
});

describe("getTextEditorLanguageId", () => {
	test("maps html family to html", () => {
		expect(getTextEditorLanguageId("html")).toBe("html");
		expect(getTextEditorLanguageId("htm")).toBe("html");
		expect(getTextEditorLanguageId("xhtml")).toBe("html");
		expect(getTextEditorLanguageId("vue")).toBe("html");
		expect(getTextEditorLanguageId("svelte")).toBe("html");
	});

	test("maps xml family to xml", () => {
		expect(getTextEditorLanguageId("xml")).toBe("xml");
		expect(getTextEditorLanguageId("svg")).toBe("xml");
		expect(getTextEditorLanguageId("plist")).toBe("xml");
	});

	test("maps common source extensions", () => {
		expect(getTextEditorLanguageId("ts")).toBe("typescript");
		expect(getTextEditorLanguageId("tsx")).toBe("tsx");
		expect(getTextEditorLanguageId("jsonc")).toBe("json");
		expect(getTextEditorLanguageId("py")).toBe("python");
		expect(getTextEditorLanguageId("yml")).toBe("yaml");
	});
});

describe("getTextEditorLanguageExtension", () => {
	test("returns a language support object for html/xml/js", () => {
		// LanguageSupport is a non-empty object / extension, not an empty array.
		expect(getTextEditorLanguageExtension("html")).not.toEqual([]);
		expect(getTextEditorLanguageExtension("htm")).not.toEqual([]);
		expect(getTextEditorLanguageExtension("xml")).not.toEqual([]);
		expect(getTextEditorLanguageExtension("ts")).not.toEqual([]);
	});

	test("returns empty extension for unknown formats", () => {
		expect(getTextEditorLanguageExtension("unknownbin")).toEqual([]);
	});
});
