import * as fs from "node:fs";
import * as path from "node:path";
import { getCustomThemesDir, getThemesDir } from "../config.js";
import type { ColorMode, ThemeInfo } from "./contracts.js";
import { isThemeDocument, parseThemeDocument, parseThemeDocumentContent, type ThemeDocument } from "./schema.js";
import type { Theme } from "./theme.js";
import { createTheme } from "./theme-factory.js";

const BUILTIN_THEMES_KEY = Symbol.for("@vetta/coding-agent/builtin-theme-documents");
let builtinThemes: Record<string, ThemeDocument> | undefined;
const registeredThemes = new Map<string, Theme>();

/** Install built-in theme documents embedded by a standalone executable composition root. */
export function installBuiltinThemeDocuments(documents: { readonly dark: unknown; readonly light: unknown }): void {
	Reflect.set(globalThis, BUILTIN_THEMES_KEY, {
		dark: parseThemeDocument("embedded dark", documents.dark),
		light: parseThemeDocument("embedded light", documents.light),
	});
}

function getBuiltinThemes(): Record<string, ThemeDocument> {
	if (!builtinThemes) {
		const installedDocuments = Reflect.get(globalThis, BUILTIN_THEMES_KEY);
		if (isBuiltinThemeDocuments(installedDocuments)) {
			builtinThemes = installedDocuments;
		} else {
			const themesDirectory = getThemesDir();
			builtinThemes = {
				dark: JSON.parse(fs.readFileSync(path.join(themesDirectory, "dark.json"), "utf-8")) as ThemeDocument,
				light: JSON.parse(fs.readFileSync(path.join(themesDirectory, "light.json"), "utf-8")) as ThemeDocument,
			};
		}
	}
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

export function getAvailableThemes(): string[] {
	const themes = new Set<string>(Object.keys(getBuiltinThemes()));
	const customThemesDirectory = getCustomThemesDir();
	if (fs.existsSync(customThemesDirectory)) {
		for (const file of fs.readdirSync(customThemesDirectory)) {
			if (file.endsWith(".json")) themes.add(file.slice(0, -5));
		}
	}
	for (const name of registeredThemes.keys()) themes.add(name);
	return Array.from(themes).sort();
}

export function getAvailableThemesWithPaths(): ThemeInfo[] {
	const themesDirectory = getThemesDir();
	const customThemesDirectory = getCustomThemesDir();
	const result: ThemeInfo[] = Object.keys(getBuiltinThemes()).map((name) => ({
		name,
		path: path.join(themesDirectory, `${name}.json`),
	}));

	if (fs.existsSync(customThemesDirectory)) {
		for (const file of fs.readdirSync(customThemesDirectory)) {
			if (!file.endsWith(".json")) continue;
			const name = file.slice(0, -5);
			if (!result.some((theme) => theme.name === name)) {
				result.push({ name, path: path.join(customThemesDirectory, file) });
			}
		}
	}

	for (const [name, theme] of registeredThemes) {
		if (!result.some((candidate) => candidate.name === name)) result.push({ name, path: theme.sourcePath });
	}
	return result.sort((left, right) => left.name.localeCompare(right.name));
}

export function loadThemeDocument(name: string): ThemeDocument {
	const builtins = getBuiltinThemes();
	if (name in builtins) return builtins[name];

	const registeredTheme = registeredThemes.get(name);
	if (registeredTheme?.sourcePath) {
		return parseThemeDocumentContent(
			registeredTheme.sourcePath,
			fs.readFileSync(registeredTheme.sourcePath, "utf-8"),
		);
	}
	if (registeredTheme) throw new Error(`Theme "${name}" does not have a source path for export`);

	const themePath = path.join(getCustomThemesDir(), `${name}.json`);
	if (!fs.existsSync(themePath)) throw new Error(`Theme not found: ${name}`);
	return parseThemeDocumentContent(name, fs.readFileSync(themePath, "utf-8"));
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
