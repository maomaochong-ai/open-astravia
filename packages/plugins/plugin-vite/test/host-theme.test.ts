import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import {
	HOST_THEME_STYLESHEET_ID,
	injectHostThemeBridge,
} from "../src/host-theme.js";

describe("injectHostThemeBridge", () => {
	it("injects the public host-theme contract into a Tailwind root stylesheet", () => {
		const css = `@layer theme, utilities;
@import "tailwindcss/theme.css" layer(theme);
@import "tailwindcss/utilities.css" layer(utilities);`;

		const result = injectHostThemeBridge(css);

		expect(result).toContain(
			`@import "tailwindcss/theme.css" layer(theme);\n@import "${HOST_THEME_STYLESHEET_ID}";`,
		);
	});

	it("leaves ordinary CSS and an explicit bridge import unchanged", () => {
		expect(injectHostThemeBridge(".panel { color: red; }")).toBeUndefined();
		expect(
			injectHostThemeBridge(
				`@import "tailwindcss";\n@import '${HOST_THEME_STYLESHEET_ID}';`,
			),
		).toBeUndefined();
	});

	it("resolves the theme contract from the public plugin-sdk export", async () => {
		const stylesheetPath = createRequire(import.meta.url).resolve(
			HOST_THEME_STYLESHEET_ID,
		);
		const stylesheet = await readFile(stylesheetPath, "utf8");

		expect(stylesheet).toContain("@theme inline");
		expect(stylesheet).toContain("--color-muted-foreground: var(--muted-foreground)");
	});
});
