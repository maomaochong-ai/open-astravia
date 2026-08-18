import { BUILTIN_THEME_DOCUMENTS } from "./builtin-theme-documents.js";
import type { ColorMode, ThemeInfo } from "./contracts.js";
import { isThemeDocument, parseThemeDocument, type ThemeDocument } from "./schema.js";
import type { Theme } from "./theme.js";
import { createTheme } from "./theme-factory.js";

const BUILTIN_THEMES_KEY = Symbol.for("@vetta/coding-agent/builtin-theme-documents");
let builtinThemes: Record<string, ThemeDocument> = {
	dark: parseThemeDocument("built-in dark", BUILTIN_THEME_DOCUMENTS.dark),
	light: parseThemeDocument("built-in light", BUILTIN_THEME_DOCUMENTS.light),
};
const registeredThemes = new Map<string, Theme>();

/** Install built-in theme documents embedded by a standalone executable composition root. */
export function installBuiltinThemeDocuments(documents: { readonly dark: unknown; readonly light: unknown }): void {
	builtinThemes = {
		dark: parseThemeDocument("embedded dark", documents.dark),
		light: parseThemeDocument("embedded light", documents.light),
	};
	Reflect.set(globalThis, BUILTIN_THEMES_KEY, builtinThemes);
}

function getBuiltinThemes(): Record<string, ThemeDocument> {
	const installedDocuments = Reflect.get(globalThis, BUILTIN_THEMES_KEY);
	if (isBuiltinThemeDocuments(installedDocuments)) builtinThemes = installedDocuments;
	return builtinThemes;
}

function isBuiltinThemeDocuments(value: unknown): value is Record<"dark" | "light", ThemeDocument> {
	if (typeof value !== "object" || value === null) return false;
	return isThemeDocument(Reflect.get(value, "dark")) && isThemeDocument(Reflect.get(value, "light"));
}

export function setRegisteredThemes(themes: Theme[]): void {
	registeredThemes.clear();
	for (const theme of themes) {
		if (theme.name) registeredThemes.set(theme.name, theme);
	}
}

export function registerTheme(theme: Theme): void {
	if (theme.name) registeredThemes.set(theme.name, theme);
}

export function getAvailableThemes(): string[] {
	const themes = new Set<string>(Object.keys(getBuiltinThemes()));
	for (const name of registeredThemes.keys()) themes.add(name);
	return Array.from(themes).sort();
}

export function getAvailableThemesWithPaths(): ThemeInfo[] {
	const result: ThemeInfo[] = Object.keys(getBuiltinThemes()).map((name) => ({
		name,
		path: undefined,
	}));

	for (const [name, theme] of registeredThemes) {
		if (!result.some((candidate) => candidate.name === name)) result.push({ name, path: theme.sourcePath });
	}
	return result.sort((left, right) => left.name.localeCompare(right.name));
}

export function loadThemeDocument(name: string): ThemeDocument {
	const builtins = getBuiltinThemes();
	if (name in builtins) return builtins[name];

	const registeredTheme = registeredThemes.get(name);
	const document = registeredTheme?.getSourceDocument();
	if (document) return document;
	if (registeredTheme) throw new Error(`Theme "${name}" does not retain its source document for export`);
	throw new Error(`Theme not found: ${name}`);
}

export function loadTheme(name: string, mode?: ColorMode): Theme {
	return registeredThemes.get(name) ?? createTheme(loadThemeDocument(name), mode);
}

export function getThemeByName(name: string): Theme | undefined {
	try {
		return loadTheme(name);
	} catch {
		return undefined;
	}
}
