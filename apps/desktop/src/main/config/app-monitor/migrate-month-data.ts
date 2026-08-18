import { migrateVersionedConfig, type VersionedConfigMigrationResult } from "@vetta/toolkit/versioned-config";
import { APP_MONITOR_MONTH_SCHEMA_VERSION } from "../../app-monitor/app-monitor-month-data.js";

const APP_MONITOR_MONTH_MIGRATIONS = [] as const;

export function migrateAppMonitorMonthData(value: unknown): VersionedConfigMigrationResult {
	return migrateVersionedConfig(value, {
		currentVersion: APP_MONITOR_MONTH_SCHEMA_VERSION,
		migrations: APP_MONITOR_MONTH_MIGRATIONS,
	});
}
