import type { FileMigration } from "@vetta/toolkit/file-migrations";

const LEGACY_PATH = "app-monitor.json";
const SUMMARY_PATH = "app-monitor/summary.json";

export const appMonitorFileMigration000To1: FileMigration = {
	version: 1,
	id: "000_to_1",
	async migrate(context) {
		const legacy = await context.readJson(LEGACY_PATH);
		if (legacy === null) return;

		const existing = await context.readJson(SUMMARY_PATH);
		if (existing === null) {
			await context.writeJson(SUMMARY_PATH, legacy);
		}

		await context.remove(LEGACY_PATH);
	},
};
