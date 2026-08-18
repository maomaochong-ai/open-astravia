import type { FileMigration } from "@vetta/toolkit/file-migrations";
import {
	isThemeStorageJson,
	isValidThemeStorageKey,
	type ThemeStorageFile,
	type ThemeStorageJson,
} from "../../../shared/theme-storage.js";
import { themeStorageKeyToMigrationPath } from "../theme-storage-layout.js";

const LEGACY_THEME_STORAGE_FILE = "data.json";

function parseThemeStorageFile(raw: string): Record<string, ThemeStorageJson> {
	const parsed = JSON.parse(raw) as Partial<ThemeStorageFile>;
	if (
		parsed === null ||
		typeof parsed !== "object" ||
		typeof parsed.version !== "number" ||
		parsed.data === null ||
		typeof parsed.data !== "object" ||
		Array.isArray(parsed.data)
	) {
		throw new Error("Invalid theme storage file shape");
	}
	const data: Record<string, ThemeStorageJson> = {};
	for (const [key, value] of Object.entries(parsed.data)) {
		if (!isValidThemeStorageKey(key) || !isThemeStorageJson(value)) continue;
		data[key] = value;
	}
	return data;
}

export const splitThemeStorageDataJsonMigration: FileMigration = {
	version: 1,
	id: "001_split_data_json",
	async migrate(context) {
		const raw = await context.readText(LEGACY_THEME_STORAGE_FILE);
		if (raw === null) return;

		const legacyData = parseThemeStorageFile(raw);
		for (const [key, value] of Object.entries(legacyData)) {
			const fileName = themeStorageKeyToMigrationPath(key);
			if (await context.exists(fileName)) continue;
			await context.writeJson(fileName, value);
		}

		await context.remove(LEGACY_THEME_STORAGE_FILE);
	},
};
