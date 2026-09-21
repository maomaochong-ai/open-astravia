import { describe, expect, it } from "vitest";
import { validateFileIconTheme } from "../../plugins/runtime/plugin-file-explorer-validation";
import { resolveFileIconTheme } from "./file-icon-theme";

const theme = validateFileIconTheme({
	id: "test",
	label: "Test",
	iconDefinitions: {
		file: "F",
		ts: "T",
		dts: "D",
		exact: "E",
		folder: "C",
		open: "O",
		src: "S",
		srcOpen: "X",
		light: "L",
		contrast: "H",
	},
	file: "file",
	folder: "folder",
	folderExpanded: "open",
	fileNames: { "special.d.ts": "exact" },
	fileExtensions: { ts: "ts", "d.ts": "dts" },
	folderNames: { src: "src" },
	folderNamesExpanded: { src: "srcOpen" },
	light: { fileExtensions: { ts: "light" } },
	highContrast: { file: "contrast" },
});
const entry = (name: string, isDirectory = false) => ({
	name,
	isDirectory,
	path: `/project/${name}`,
	size: 0,
	modifiedAt: 0,
});

describe("file icon themes", () => {
	it("prioritizes exact names and longest suffix while preserving variant fallbacks", () => {
		expect(resolveFileIconTheme(theme, entry("SPECIAL.D.TS"), false, "dark")).toBe("E");
		expect(resolveFileIconTheme(theme, entry("index.d.ts"), false, "light")).toBe("D");
		expect(resolveFileIconTheme(theme, entry("index.ts"), false, "light")).toBe("L");
		expect(resolveFileIconTheme(theme, entry("README"), false, "highContrast")).toBe("H");
	});
	it("resolves named and generic folder icons for both expansion states", () => {
		expect(resolveFileIconTheme(theme, entry("SRC", true), false, "dark")).toBe("S");
		expect(resolveFileIconTheme(theme, entry("src", true), true, "dark")).toBe("X");
		expect(resolveFileIconTheme(theme, entry("lib", true), true, "dark")).toBe("O");
	});
});
