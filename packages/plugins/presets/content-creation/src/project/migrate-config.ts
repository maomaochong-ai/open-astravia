import { migrateVersionedConfig, type VersionedConfigMigrationResult } from "@vetta/toolkit/versioned-config";
import { contentProjectMigration001To2 } from "./migrations/001_to_2";
import { contentProjectMigration002To3 } from "./migrations/002_to_3";
import { contentProjectMigration003To4 } from "./migrations/003_to_4";
import { contentProjectMigration004To5 } from "./migrations/004_to_5";
import { CONTENT_CREATION_SCHEMA_VERSION } from "./types";

const CONTENT_PROJECT_MIGRATIONS = [
	contentProjectMigration001To2,
	contentProjectMigration002To3,
	contentProjectMigration003To4,
	contentProjectMigration004To5,
] as const;

export function migrateContentProjectConfig(value: unknown): VersionedConfigMigrationResult {
	return migrateVersionedConfig(value, {
		currentVersion: CONTENT_CREATION_SCHEMA_VERSION,
		migrations: CONTENT_PROJECT_MIGRATIONS,
	});
}
