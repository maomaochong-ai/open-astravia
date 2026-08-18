import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { isValidThemeStorageKey } from "../../shared/theme-storage.js";

const STORAGE_FILE_EXTENSION = ".json";
const LEGACY_STORAGE_FILE_NAME = "data.json";
const WINDOWS_RESERVED_FILE_NAMES = new Set([
	"CON",
	"PRN",
	"AUX",
	"NUL",
	"COM1",
	"COM2",
	"COM3",
	"COM4",
	"COM5",
	"COM6",
	"COM7",
	"COM8",
	"COM9",
	"LPT1",
	"LPT2",
	"LPT3",
	"LPT4",
	"LPT5",
	"LPT6",
	"LPT7",
	"LPT8",
	"LPT9",
]);

export function legacyThemeStorageFilePath(themeDir: string): string {
	return join(themeDir, LEGACY_STORAGE_FILE_NAME);
}

export function themeStorageValuePath(themeDir: string, key: string): string {
	return join(themeDir, themeStorageKeyToFileName(key));
}

export async function listThemeStorageValueFiles(
	themeDir: string,
): Promise<Array<{ readonly key: string; readonly fileName: string; readonly path: string }>> {
	const entries = await readdir(themeDir, { withFileTypes: true });
	const files: Array<{ key: string; fileName: string; path: string }> = [];
	for (const entry of entries) {
		if (!entry.isFile()) continue;
		const key = themeStorageFileNameToKey(entry.name);
		if (!key) continue;
		files.push({
			fileName: entry.name,
			key,
			path: join(themeDir, entry.name),
		});
	}
	return files;
}

export function themeStorageKeyToMigrationPath(key: string): string {
	return themeStorageKeyToFileName(key);
}

function themeStorageKeyToFileName(key: string): string {
	const encoded = encodeURIComponent(key);
	if (key === "data" || WINDOWS_RESERVED_FILE_NAMES.has(key.toUpperCase())) {
		return `%${encoded}${STORAGE_FILE_EXTENSION}`;
	}
	return `${encoded}${STORAGE_FILE_EXTENSION}`;
}

function themeStorageFileNameToKey(fileName: string): string | null {
	if (!fileName.endsWith(STORAGE_FILE_EXTENSION)) return null;
	if (fileName === LEGACY_STORAGE_FILE_NAME) return null;
	try {
		const rawKey = fileName.slice(0, -STORAGE_FILE_EXTENSION.length);
		const key = decodeURIComponent(rawKey.startsWith("%") ? rawKey.slice(1) : rawKey);
		return isValidThemeStorageKey(key) ? key : null;
	} catch {
		return null;
	}
}
