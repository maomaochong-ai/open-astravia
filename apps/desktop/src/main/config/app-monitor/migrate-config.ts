import { migrateVersionedConfig, type VersionedConfigMigrationResult } from "@vetta/toolkit/versioned-config";
import { APP_MONITOR_SCHEMA_VERSION } from "../../app-monitor/app-monitor-data.js";

const APP_MONITOR_MIGRATIONS = [] as const;

export function migrateAppMonitorData(value: unknown): VersionedConfigMigrationResult {
	return migrateVersionedConfig(value, {
		currentVersion: APP_MONITOR_SCHEMA_VERSION,
		migrations: APP_MONITOR_MIGRATIONS,
	});
}
