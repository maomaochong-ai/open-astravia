import { ansi256ToHex, resolveThemeColors } from "./colors.js";
import type { ColorValue, ThemeExportColors } from "./contracts.js";
import { loadThemeDocument } from "./theme-catalog.js";
import { getCurrentThemeName, getDefaultThemeName } from "./theme-state.js";

export function getResolvedThemeColors(themeName?: string): Record<string, string> {
	const name = themeName ?? getCurrentThemeName() ?? getDefaultThemeName();
	const document = loadThemeDocument(name);
	const resolved = resolveThemeColors(document.colors, document.vars);
	const defaultText = name === "light" ? "#000000" : "#e5e5e7";
	const colors: Record<string, string> = {};
	for (const [key, value] of Object.entries(resolved)) {
		colors[key] = typeof value === "number" ? ansi256ToHex(value) : value === "" ? defaultText : value;
	}
	return colors;
}

export function isLightTheme(themeName?: string): boolean {
	return themeName === "light";
}

export function getThemeExportColors(themeName?: string): ThemeExportColors {
	const name = themeName ?? getCurrentThemeName() ?? getDefaultThemeName();
	try {
		const document = loadThemeDocument(name);
		if (!document.export) return {};
		return {
			pageBg: resolveExportColor(document.export.pageBg, document.vars),
			cardBg: resolveExportColor(document.export.cardBg, document.vars),
			infoBg: resolveExportColor(document.export.infoBg, document.vars),
		};
	} catch {
		return {};
	}
}

function resolveExportColor(
	value: ColorValue | undefined,
	variables: Readonly<Record<string, ColorValue>> = {},
): string | undefined {
	if (value === undefined) return undefined;
	if (typeof value === "number") return ansi256ToHex(value);
	if (!value.startsWith("$")) return value;
	const resolved = variables[value];
	if (typeof resolved === "number") return ansi256ToHex(resolved);
	return resolved;
}
