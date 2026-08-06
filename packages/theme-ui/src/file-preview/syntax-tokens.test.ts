import { describe, expect, test } from "vitest";
import {
	SYNTAX_PALETTE_VSCODE_DARK,
	SYNTAX_PALETTE_VSCODE_LIGHT,
	SYNTAX_TOKEN_CSS_VARS,
	SYNTAX_TOKEN_IDS,
	syntaxPaletteToCssDeclarations,
	syntaxVar,
} from "./syntax-tokens";

describe("syntax tokens", () => {
	test("every token has a CSS var and both palettes", () => {
		for (const id of SYNTAX_TOKEN_IDS) {
			expect(SYNTAX_TOKEN_CSS_VARS[id]).toMatch(/^--syntax-/);
			expect(SYNTAX_PALETTE_VSCODE_DARK[id]).toMatch(/^#/);
			expect(SYNTAX_PALETTE_VSCODE_LIGHT[id]).toMatch(/^#/);
		}
	});

	test("syntaxVar wraps the custom property", () => {
		expect(syntaxVar("keyword")).toBe("var(--syntax-keyword)");
		expect(syntaxVar("tag")).toBe("var(--syntax-tag)");
	});

	test("palette serializes to CSS declarations", () => {
		const css = syntaxPaletteToCssDeclarations(SYNTAX_PALETTE_VSCODE_DARK);
		expect(css).toContain("--syntax-keyword: #569CD6;");
		expect(css).toContain("--syntax-string: #CE9178;");
		expect(css.split("\n").length).toBe(SYNTAX_TOKEN_IDS.length);
	});
});
