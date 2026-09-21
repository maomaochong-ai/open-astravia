import type { TeamWorkItem } from "./collaboration.js";

export const DEFAULT_TEAM_AUTOMATIC_RETRIES = 2;
export const TEAM_RECOVERY_EXHAUSTED = "TEAM_RECOVERY_EXHAUSTED";

export interface TeamTaskRecovery {
	readonly maxAutomaticRetries: number;
	readonly automaticRetries: number;
}

export function isTeamTaskRecovery(value: unknown): value is TeamTaskRecovery {
	if (typeof value !== "object" || value === null) return false;
	const record = value as Record<string, unknown>;
	return (
		isTeamRetryLimit(record.maxAutomaticRetries) &&
		typeof record.automaticRetries === "number" &&
		Number.isSafeInteger(record.automaticRetries) &&
		record.automaticRetries >= 0
	);
}

export function isTeamRetryLimit(value: unknown): value is number {
	return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 10;
}

export function teamTaskRecovery(item: TeamWorkItem): TeamTaskRecovery {
	return item.recovery ?? { maxAutomaticRetries: DEFAULT_TEAM_AUTOMATIC_RETRIES, automaticRetries: 0 };
}

export function canAutomaticallyRecoverTeamTask(item: TeamWorkItem): boolean {
	const recovery = teamTaskRecovery(item);
	return recovery.automaticRetries < recovery.maxAutomaticRetries;
}

export function teamAutomaticRetryDelay(retries: number, providerDelay?: number): number {
	return providerDelay === undefined
		? Math.min(1_000 * 2 ** retries, 30_000)
		: Math.max(0, Math.min(providerDelay, 60_000));
}
