import { atomicWriteJSONAsync } from "@vetta/toolkit/atomic-write";
import { createVersionedJsonConfigStore, type VersionedJsonConfigStore } from "@vetta/toolkit/config-store";
import { migrateAppMonitorData } from "../config/app-monitor/migrate-config.js";
import { migrateAppMonitorMonthData } from "../config/app-monitor/migrate-month-data.js";
import { getAppLogger } from "../logger.js";
import { type AppMonitorData, normalizeAppMonitorData } from "./app-monitor-data.js";
import { appMonitorMonthPath, appMonitorProfilePath, appMonitorSummaryPath } from "./app-monitor-layout.js";
import { type AppMonitorMonthData, normalizeAppMonitorMonthData } from "./app-monitor-month-data.js";
import { type AppMonitorProfile, normalizeAppMonitorProfile } from "./app-monitor-profile.js";

const log = getAppLogger("app-monitor");

export const appMonitorStore = createVersionedJsonConfigStore<AppMonitorData>({
	path: appMonitorSummaryPath(),
	name: "app-monitor",
	normalize: normalizeAppMonitorData,
	migrate: migrateAppMonitorData,
	writeJson: atomicWriteJSONAsync,
	logger: log,
});

export const appMonitorProfileStore = createVersionedJsonConfigStore<AppMonitorProfile>({
	path: appMonitorProfilePath(),
	name: "app-monitor-profile",
	normalize: normalizeAppMonitorProfile,
	writeJson: atomicWriteJSONAsync,
	logger: log,
});

export function createAppMonitorMonthStore(
	month: string,
	profile: AppMonitorProfile,
): VersionedJsonConfigStore<AppMonitorMonthData> {
	return createVersionedJsonConfigStore<AppMonitorMonthData>({
		path: appMonitorMonthPath(month),
		name: `app-monitor-month-${month}`,
		normalize: (value) => normalizeAppMonitorMonthData(value, month, profile),
		migrate: migrateAppMonitorMonthData,
		writeJson: atomicWriteJSONAsync,
		logger: log,
	});
}
