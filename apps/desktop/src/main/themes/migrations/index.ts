import { runFileMigrations } from "@vetta/toolkit/file-migrations";
import type { getAppLogger } from "../../logger.js";
import { splitThemeStorageDataJsonMigration } from "./001_split_data_json.js";

const THEME_STORAGE_FILE_MIGRATIONS = [splitThemeStorageDataJsonMigration] as const;

export async function runThemeStorageFileMigrations(
	root: string,
	logger: ReturnType<typeof getAppLogger>,
): Promise<void> {
	const result = await runFileMigrations({
		logger,
		migrations: THEME_STORAGE_FILE_MIGRATIONS,
		root,
	});
	if (result.applied.length > 0) {
		logger.info(
			`Migrated theme storage files to v${result.currentVersion}: ${result.applied.map((entry) => entry.id).join(", ")}`,
		);
	}
}
