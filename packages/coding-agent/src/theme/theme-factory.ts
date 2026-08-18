import { resolveThemeColors } from "./colors.js";
import type { ColorMode, ThemeBg, ThemeColor } from "./contracts.js";
import { getThemeRuntimeConfiguration } from "./runtime-configuration.js";
import { parseThemeDocumentContent, type ThemeDocument } from "./schema.js";
import { Theme } from "./theme.js";

const BACKGROUND_COLOR_KEYS = new Set<string>([
	"selectedBg",
	"userMessageBg",
	"customMessageBg",
	"toolPendingBg",
	"toolSuccessBg",
	"toolErrorBg",
]);

export function createTheme(document: ThemeDocument, mode?: ColorMode, sourcePath?: string): Theme {
	const resolvedColors = resolveThemeColors(document.colors, document.vars);
	const foregroundColors = {} as Record<ThemeColor, string | number>;
	const backgroundColors = {} as Record<ThemeBg, string | number>;
	for (const [key, value] of Object.entries(resolvedColors)) {
		if (BACKGROUND_COLOR_KEYS.has(key)) backgroundColors[key as ThemeBg] = value;
		else foregroundColors[key as ThemeColor] = value;
	}
	return new Theme(foregroundColors, backgroundColors, mode ?? getThemeRuntimeConfiguration().colorMode, {
		name: document.name,
		sourcePath,
		sourceDocument: document,
	});
}

export function loadThemeFromContent(themePath: string, content: string, mode?: ColorMode): Theme {
	return createTheme(parseThemeDocumentContent(themePath, content), mode, themePath);
}
