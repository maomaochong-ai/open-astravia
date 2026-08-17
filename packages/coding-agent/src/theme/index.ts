export type { ThemeBg, ThemeColor, ThemeInfo } from "./contracts.js";
export { getResolvedThemeColors, getThemeExportColors, isLightTheme } from "./html-theme.js";
export { getLanguageFromPath, highlightCode } from "./syntax-highlighting.js";
export { Theme } from "./theme.js";
export {
	getAvailableThemes,
	getAvailableThemesWithPaths,
	getThemeByName,
	installBuiltinThemeDocuments,
	setRegisteredThemes,
} from "./theme-catalog.js";
export { loadThemeFromContent } from "./theme-factory.js";
export { initTheme, onThemeChange, setTheme, setThemeInstance, stopThemeWatcher, theme } from "./theme-state.js";
