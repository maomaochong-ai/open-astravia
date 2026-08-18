import { join } from "node:path";
import { getVettaHomePath } from "@vetta/action-rpc";

const MONTH_KEY_PATTERN = /^\d{4}-\d{2}$/;

export function appMonitorRootPath(): string {
	return join(getVettaHomePath(), "app-monitor");
}

export function appMonitorSummaryPath(): string {
	return join(appMonitorRootPath(), "summary.json");
}

export function appMonitorProfilePath(): string {
	return join(appMonitorRootPath(), "profile.json");
}

export function appMonitorMonthPath(month: string): string {
	if (!MONTH_KEY_PATTERN.test(month)) throw new Error(`Invalid app monitor month: ${month}`);
	return join(appMonitorRootPath(), "months", `${month}.json`);
}
