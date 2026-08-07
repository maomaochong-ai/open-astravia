import { migrateVersionedConfig, type VersionedConfigMigrationResult } from "@vetta/toolkit/versioned-config";
import { contentProjectMigration001To2 } from "./migrations/001_to_2";
import { contentProjectMigration002To3 } from "./migrations/002_to_3";
import { CONTENT_CREATION_SCHEMA_VERSION } from "./types";

const CONTENT_PROJECT_MIGRATIONS = [contentProjectMigration001To2, contentProjectMigration002To3] as const;

export function migrateContentProjectConfig(value: unknown): VersionedConfigMigrationResult {
	return migrateVersionedConfig(value, {
		currentVersion: CONTENT_CREATION_SCHEMA_VERSION,
		migrations: CONTENT_PROJECT_MIGRATIONS,
	});
}
