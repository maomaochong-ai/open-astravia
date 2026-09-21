import { migrateVersionedConfig } from "@vetta/toolkit/versioned-config";
import { Minimatch } from "minimatch";

export interface FileExplorerPreferences {
	schemaVersion: 1;
	showHidden: boolean;
	exclude: string[];
	iconTheme: string;
}

export const FILE_EXPLORER_PREFERENCES_KEY = "vetta-file-explorer";
export const DEFAULT_FILE_EXPLORER_PREFERENCES: FileExplorerPreferences = {
	schemaVersion: 1,
	showHidden: true,
	exclude: ["**/.DS_Store", "**/Thumbs.db", "**/desktop.ini"],
	iconTheme: "builtin",
};

export function normalizeFileExplorerPreferences(value: unknown): FileExplorerPreferences {
	const defaults = DEFAULT_FILE_EXPLORER_PREFERENCES;
	let migrated: Record<string, unknown>;
	try {
		migrated = migrateVersionedConfig(value, {
			currentVersion: 1,
			migrations: [],
		}).config;
	} catch {
		return { ...defaults, exclude: [...defaults.exclude] };
	}
	const source = migrated as Partial<FileExplorerPreferences>;
	return {
		schemaVersion: 1,
		showHidden: typeof source.showHidden === "boolean" ? source.showHidden : defaults.showHidden,
		exclude:
			Array.isArray(source.exclude) &&
			source.exclude.length <= 100 &&
			source.exclude.every((item) => typeof item === "string" && item.length <= 1024)
				? source.exclude
						.slice(0, 100)
						.map((item) => item.trim())
						.filter(Boolean)
				: [...defaults.exclude],
		iconTheme: typeof source.iconTheme === "string" && source.iconTheme ? source.iconTheme : defaults.iconTheme,
	};
}

export function readFileExplorerPreferences(): FileExplorerPreferences {
	try {
		return normalizeFileExplorerPreferences(
			JSON.parse(localStorage.getItem(FILE_EXPLORER_PREFERENCES_KEY) ?? "null"),
		);
	} catch {
		return normalizeFileExplorerPreferences(null);
	}
}

/** Compile once per preference change, not once per row. Patterns are workspace-relative. */
export function createFileExplorerVisibility(
	root: string,
	preferences: FileExplorerPreferences,
): (path: string) => boolean {
	const base = root.replace(/\\/g, "/").replace(/\/+$/, "");
	const patterns = preferences.exclude.map(
		(pattern) => new Minimatch(pattern, { dot: true, nonegate: true, nocomment: true }),
	);
	return (path) => {
		const normalized = path.replace(/\\/g, "/").replace(/\/+$/, "");
		const normalizedLower = normalized.toLowerCase();
		const baseLower = base.toLowerCase();
		if (normalizedLower !== baseLower && !normalizedLower.startsWith(`${baseLower}/`)) return false;
		if (normalizedLower === baseLower) return true;
		const relative = normalized.slice(base.length + 1);
		const parts = relative.split("/");
		if (!preferences.showHidden && parts.some((part) => part.startsWith("."))) return false;
		// An excluded folder also excludes cached descendants and keyboard/selection targets.
		return !parts.some((_, index) => patterns.some((pattern) => pattern.match(parts.slice(0, index + 1).join("/"))));
	};
}
