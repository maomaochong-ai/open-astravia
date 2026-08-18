import { getVettaHomePath } from "@vetta/action-rpc";
import { runFileMigrations } from "@vetta/toolkit/file-migrations";
import type { getAppLogger } from "../../logger.js";
import { appMonitorFileMigration000To1 } from "./000_to_1.js";
import { appMonitorFileMigration001To2 } from "./001_to_2.js";

const APP_MONITOR_FILE_MIGRATIONS = [appMonitorFileMigration000To1, appMonitorFileMigration001To2] as const;

export async function runAppMonitorFileMigrations(logger: ReturnType<typeof getAppLogger>): Promise<void> {
	const result = await runFileMigrations({
		logger,
		migrations: APP_MONITOR_FILE_MIGRATIONS,
		root: getVettaHomePath(),
		statePath: "app-monitor/.migrations.json",
	});
	if (result.applied.length > 0) {
		logger.info(
			`Migrated app monitor files to v${result.currentVersion}: ${result.applied.map((entry) => entry.id).join(", ")}`,
		);
	}
}
