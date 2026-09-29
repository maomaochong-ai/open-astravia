import { migrateVersionedConfig, type VersionedConfigMigrationResult } from "@vetta/toolkit/versioned-config";
import { migrateDesktopConfigV1ToV2 } from "./migrations/001_to_2.js";

export const DESKTOP_CONFIG_SCHEMA_VERSION = 2;

export function migrateDesktopConfig(value: unknown): VersionedConfigMigrationResult {
	return migrateVersionedConfig(value, {
		currentVersion: DESKTOP_CONFIG_SCHEMA_VERSION,
		initialVersion: 1,
		migrations: [migrateDesktopConfigV1ToV2],
		futureVersionPolicy: "preserve",
	});
}
