import type { FileMigration } from "@vetta/toolkit/file-migrations";

const LEGACY_PATH = "app-monitor.json";
const SUMMARY_PATH = "app-monitor/summary.json";
const MONTHS_PATH = "app-monitor/months";

export const appMonitorFileMigration001To2: FileMigration = {
	version: 2,
	id: "001_to_2",
	async migrate(context) {
		await context.remove(LEGACY_PATH);
		await context.remove(SUMMARY_PATH);
		await context.remove(MONTHS_PATH);
	},
};
