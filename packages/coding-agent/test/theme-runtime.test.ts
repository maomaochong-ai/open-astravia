import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
	getLanguageFromPath,
	getResolvedThemeColors,
	getThemeExportColors,
	installBuiltinThemeDocuments,
	loadThemeFromContent,
} from "../src/modes/interactive/theme/theme.js";

const darkThemePath = fileURLToPath(new URL("../src/modes/interactive/theme/dark.json", import.meta.url));
const lightThemePath = fileURLToPath(new URL("../src/modes/interactive/theme/light.json", import.meta.url));

function readThemeDocument(path: string): Record<string, unknown> {
	return JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
}

describe("theme runtime", () => {
	it("parses variables into a named truecolor theme", () => {
		const document = readThemeDocument(darkThemePath);
		document.name = "custom-dark";
		const theme = loadThemeFromContent("memory://custom-dark.json", JSON.stringify(document), "truecolor");

		expect(theme.name).toBe("custom-dark");
		expect(theme.sourcePath).toBe("memory://custom-dark.json");
		expect(theme.getColorMode()).toBe("truecolor");
		expect(theme.getFgAnsi("accent")).toBe("\u001b[38;2;138;190;183m");
		expect(theme.getBgAnsi("userMessageBg")).toBe("\u001b[48;2;52;53;65m");
		expect(theme.getThinkingBorderColor("unknown" as "off")("text")).toBe(
			`${theme.getFgAnsi("thinkingOff")}text\u001b[39m`,
		);
	});

	it("reports invalid tokens with the theme label and property path", () => {
		const document = readThemeDocument(darkThemePath);
		const colors = document.colors as Record<string, unknown>;
		delete colors.accent;

		expect(() => loadThemeFromContent("broken.json", JSON.stringify(document), "truecolor")).toThrow(
			/Invalid theme "broken\.json":[\s\S]*Other errors:[\s\S]*\/colors\/accent/,
		);
	});

	it("projects built-in terminal colors and explicit export colors for HTML", () => {
		installBuiltinThemeDocuments({
			dark: readThemeDocument(darkThemePath),
			light: readThemeDocument(lightThemePath),
		});

		expect(getResolvedThemeColors("dark")).toMatchObject({
			accent: "#8abeb7",
			text: "#e5e5e7",
			userMessageBg: "#343541",
		});
		expect(getThemeExportColors("dark")).toEqual({
			pageBg: "#18181e",
			cardBg: "#1e1e24",
			infoBg: "#3c3728",
		});
	});

	it.each([
		["src/index.ts", "typescript"],
		["component.jsx", "javascript"],
		["Dockerfile", "dockerfile"],
		["README", undefined],
	])("maps %s to its syntax language", (path, expected) => {
		expect(getLanguageFromPath(path)).toBe(expected);
	});
});
