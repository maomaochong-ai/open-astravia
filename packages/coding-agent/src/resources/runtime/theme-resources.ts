import { existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { loadThemeFromPath, type Theme } from "../../modes/interactive/theme/theme.js";
import type { ResourceDiagnostic } from "../contracts/diagnostics.js";

export function loadThemeResources(
	paths: string[],
	cwd: string,
): {
	themes: Theme[];
	diagnostics: ResourceDiagnostic[];
} {
	const themes: Theme[] = [];
	const diagnostics: ResourceDiagnostic[] = [];
	for (const path of paths) {
		const resolved = resolve(cwd, path);
		if (!existsSync(resolved)) {
			diagnostics.push({ type: "warning", message: "theme path does not exist", path: resolved });
			continue;
		}
		try {
			const stats = statSync(resolved);
			if (stats.isDirectory()) loadThemesFromDir(resolved, themes, diagnostics);
			else if (stats.isFile() && resolved.endsWith(".json")) loadThemeFile(resolved, themes, diagnostics);
			else diagnostics.push({ type: "warning", message: "theme path is not a json file", path: resolved });
		} catch (error) {
			diagnostics.push({
				type: "warning",
				message: error instanceof Error ? error.message : "failed to read theme path",
				path: resolved,
			});
		}
	}
	return dedupeThemes(themes, diagnostics);
}

function loadThemesFromDir(dir: string, themes: Theme[], diagnostics: ResourceDiagnostic[]): void {
	try {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			let isFile = entry.isFile();
			if (entry.isSymbolicLink()) {
				try {
					isFile = statSync(join(dir, entry.name)).isFile();
				} catch {
					continue;
				}
			}
			if (isFile && entry.name.endsWith(".json")) loadThemeFile(join(dir, entry.name), themes, diagnostics);
		}
	} catch (error) {
		diagnostics.push({
			type: "warning",
			message: error instanceof Error ? error.message : "failed to read theme directory",
			path: dir,
		});
	}
}

function loadThemeFile(filePath: string, themes: Theme[], diagnostics: ResourceDiagnostic[]): void {
	try {
		themes.push(loadThemeFromPath(filePath));
	} catch (error) {
		diagnostics.push({
			type: "warning",
			message: error instanceof Error ? error.message : "failed to load theme",
			path: filePath,
		});
	}
}

function dedupeThemes(
	themes: Theme[],
	diagnostics: ResourceDiagnostic[],
): {
	themes: Theme[];
	diagnostics: ResourceDiagnostic[];
} {
	const seen = new Map<string, Theme>();
	for (const theme of themes) {
		const name = theme.name ?? "unnamed";
		const existing = seen.get(name);
		if (existing) {
			diagnostics.push({
				type: "collision",
				message: `name "${name}" collision`,
				path: theme.sourcePath,
				collision: {
					resourceType: "theme",
					name,
					winnerPath: existing.sourcePath ?? "<builtin>",
					loserPath: theme.sourcePath ?? "<builtin>",
				},
			});
		} else seen.set(name, theme);
	}
	return { themes: Array.from(seen.values()), diagnostics };
}
