import { getThemeRuntimeConfiguration, type ThemeWatchSubscription } from "./runtime-configuration.js";
import type { Theme } from "./theme.js";
import { loadTheme, registerTheme } from "./theme-catalog.js";
import { loadThemeFromContent } from "./theme-factory.js";

const THEME_KEY = Symbol.for("@vetta/coding-agent:theme");

export const theme: Theme = new Proxy({} as Theme, {
	get(_target, property) {
		const activeTheme = (globalThis as Record<symbol, Theme>)[THEME_KEY];
		if (!activeTheme) throw new Error("Theme not initialized. Call initTheme() first.");
		return (activeTheme as unknown as Record<string | symbol, unknown>)[property];
	},
});

let currentThemeName: string | undefined;
let themeWatcher: ThemeWatchSubscription | undefined;
let onThemeChangeCallback: (() => void) | undefined;

function setGlobalTheme(nextTheme: Theme): void {
	(globalThis as Record<symbol, Theme>)[THEME_KEY] = nextTheme;
}

export function getCurrentThemeName(): string | undefined {
	return currentThemeName;
}

export function getDefaultThemeName(): string {
	return getThemeRuntimeConfiguration().defaultThemeName;
}

export function initTheme(themeName?: string, enableWatcher = false): void {
	const name = themeName ?? getDefaultThemeName();
	currentThemeName = name;
	try {
		setGlobalTheme(loadTheme(name));
		if (enableWatcher) startThemeWatcher();
	} catch {
		currentThemeName = "dark";
		setGlobalTheme(loadTheme("dark"));
	}
}

export function setTheme(name: string, enableWatcher = false): { success: boolean; error?: string } {
	currentThemeName = name;
	try {
		setGlobalTheme(loadTheme(name));
		if (enableWatcher) startThemeWatcher();
		onThemeChangeCallback?.();
		return { success: true };
	} catch (error) {
		currentThemeName = "dark";
		setGlobalTheme(loadTheme("dark"));
		return { success: false, error: error instanceof Error ? error.message : String(error) };
	}
}

export function setThemeInstance(themeInstance: Theme): void {
	setGlobalTheme(themeInstance);
	currentThemeName = "<in-memory>";
	stopThemeWatcher();
	onThemeChangeCallback?.();
}

export function onThemeChange(callback: () => void): void {
	onThemeChangeCallback = callback;
}

function startThemeWatcher(): void {
	stopThemeWatcher();
	if (!currentThemeName || currentThemeName === "dark" || currentThemeName === "light") return;
	const current = loadTheme(currentThemeName);
	const themeFile = current.sourcePath;
	const watcher = getThemeRuntimeConfiguration().watcher;
	if (!themeFile || !watcher) return;
	try {
		themeWatcher = watcher.watch(themeFile, (event) => {
			if (event.kind === "changed") reloadCurrentTheme(themeFile, event.content);
			else fallbackWhenThemeWasRemoved();
		});
	} catch {
		// Watching is optional; the selected theme remains active.
	}
}

function reloadCurrentTheme(themeFile: string, content: string): void {
	try {
		if (!currentThemeName) return;
		const current = loadThemeFromContent(themeFile, content, loadTheme(currentThemeName).getColorMode());
		registerTheme(current);
		setGlobalTheme(current);
		onThemeChangeCallback?.();
	} catch {
		// Editors may expose a temporarily invalid document while writing.
	}
}

function fallbackWhenThemeWasRemoved(): void {
	currentThemeName = "dark";
	setGlobalTheme(loadTheme("dark"));
	stopThemeWatcher();
	onThemeChangeCallback?.();
}

export function stopThemeWatcher(): void {
	themeWatcher?.close();
	themeWatcher = undefined;
}
