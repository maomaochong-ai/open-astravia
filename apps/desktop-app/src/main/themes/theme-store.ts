import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { getVettaHomePath } from "@vetta/action-rpc";
import { app } from "electron";
import type { DesktopThemePackage, DesktopThemePackageSource } from "../../preload/api-types/themes.js";

interface ThemeManifest {
	id: string;
	displayName: Record<string, string>;
	version: string;
	sdkVersion: string;
	entry: string;
	styles?: string[];
	development?: {
		origin: string;
		entry: string;
	};
	moduleFederation: {
		remoteName: string;
		expose: string;
	};
}

function systemThemesBaseDir(): string {
	return app.isPackaged
		? join(process.resourcesPath, "system-themes")
		: join(process.cwd(), ".artifacts", "system-themes");
}

function remoteThemesBaseDir(): string {
	return join(getVettaHomePath(), "themes");
}

function parseManifest(path: string): ThemeManifest {
	const value = JSON.parse(readFileSync(path, "utf8")) as Partial<ThemeManifest>;
	if (
		typeof value.id !== "string" ||
		typeof value.version !== "string" ||
		typeof value.sdkVersion !== "string" ||
		typeof value.entry !== "string" ||
		value.displayName === null ||
		typeof value.displayName !== "object" ||
		typeof value.moduleFederation?.remoteName !== "string" ||
		typeof value.moduleFederation.expose !== "string"
	) {
		throw new Error(`Invalid theme manifest: ${path}`);
	}
	return value as ThemeManifest;
}

function toThemeUrl(source: DesktopThemePackageSource, themeId: string, relativePath: string, version: string): string {
	return `vetta-theme://${source}--${themeId}/${relativePath.replaceAll("\\", "/")}?v=${encodeURIComponent(version)}`;
}

function toDevelopmentThemeUrl(origin: string, relativePath: string): string {
	return new URL(relativePath.replaceAll("\\", "/"), `${origin.replace(/\/+$/, "")}/`).href;
}

function discoverFrom(baseDir: string, source: DesktopThemePackageSource): DesktopThemePackage[] {
	if (!existsSync(baseDir)) return [];
	const themes: DesktopThemePackage[] = [];
	for (const entry of readdirSync(baseDir)) {
		const themeDir = join(baseDir, entry);
		if (!statSync(themeDir).isDirectory()) continue;
		try {
			const manifest = parseManifest(join(themeDir, "theme.json"));
			if (manifest.id !== entry) continue;
			const development =
				!app.isPackaged &&
				process.env.VETTA_THEME_DEV_SERVER === "1" &&
				source === "builtin" &&
				manifest.development !== undefined
					? manifest.development
					: undefined;
			themes.push({
				id: manifest.id,
				displayName: manifest.displayName,
				version: manifest.version,
				sdkVersion: manifest.sdkVersion,
				source,
				entryUrl: development
					? toDevelopmentThemeUrl(development.origin, development.entry)
					: toThemeUrl(source, manifest.id, manifest.entry, manifest.version),
				styleUrls: development
					? []
					: (manifest.styles ?? []).map((style) => toThemeUrl(source, manifest.id, style, manifest.version)),
				moduleFederation: manifest.moduleFederation,
			});
		} catch (error) {
			console.warn(`Skipping invalid ${source} theme ${entry}`, error);
		}
	}
	return themes;
}

export function listThemes(): DesktopThemePackage[] {
	const builtin = discoverFrom(systemThemesBaseDir(), "builtin");
	const builtinIds = new Set(builtin.map((theme) => theme.id));
	const remote = discoverFrom(remoteThemesBaseDir(), "remote").filter((theme) => !builtinIds.has(theme.id));
	const themes = [...builtin, ...remote];
	return app.isPackaged ? themes.filter((theme) => theme.id !== "xianxia") : themes;
}

export function resolveThemeFilePath(themeId: string, source: DesktopThemePackageSource, relativePath: string): string {
	if (!/^[a-z0-9][a-z0-9._-]*$/i.test(themeId)) throw new Error("Invalid theme id");
	const baseDir = source === "builtin" ? systemThemesBaseDir() : remoteThemesBaseDir();
	const root = resolve(baseDir, themeId);
	const target = resolve(root, relativePath);
	if (target !== root && !target.startsWith(`${root}\\`) && !target.startsWith(`${root}/`)) {
		throw new Error("Theme file path escapes theme directory");
	}
	return target;
}
