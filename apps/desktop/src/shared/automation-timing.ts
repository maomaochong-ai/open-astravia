/** 自动化触发时刻的计算，main 调度与 renderer 列表（下次运行）共用，按本机时区。 */
import { Cron } from "croner";
import { type AutomationSchedule, automationScheduleToCron } from "./automation.js";

/** 调度一律按本机时区，与用户在表单里看到的时刻一致。 */
export function localTimezone(): string {
	return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

export function isValidCronExpression(cronExpression: string): boolean {
	if (cronExpression.trim().split(/\s+/).length !== 5) return false;
	try {
		new Cron(cronExpression, { paused: true, timezone: localTimezone() }).stop();
		return true;
	} catch {
		return false;
	}
}

export function isValidSchedule(schedule: AutomationSchedule): boolean {
	if (schedule.kind === "once") return Number.isFinite(schedule.at);
	if (schedule.kind === "interval") return schedule.everyMinutes >= 1 && Number.isFinite(schedule.startAt);
	const cron = automationScheduleToCron(schedule);
	return cron !== null && isValidCronExpression(cron);
}

/** 间隔计划在 after 之后的第一个触发点：startAt + k·间隔。 */
function nextIntervalFire(schedule: { everyMinutes: number; startAt: number }, after: number): number {
	const step = schedule.everyMinutes * 60_000;
	if (after < schedule.startAt) return schedule.startAt + step;
	return schedule.startAt + (Math.floor((after - schedule.startAt) / step) + 1) * step;
}

/** 下一次触发时刻；once 已过期或计划无效时返回 null。 */
export function nextFireTime(schedule: AutomationSchedule, after: number): number | null {
	if (schedule.kind === "once") return schedule.at > after ? schedule.at : null;
	if (schedule.kind === "interval") return nextIntervalFire(schedule, after);
	const cron = automationScheduleToCron(schedule);
	if (!cron || !isValidCronExpression(cron)) return null;
	const next = new Cron(cron, { paused: true, timezone: localTimezone() }).nextRun(new Date(after));
	return next ? next.getTime() : null;
}

export interface FireWindowSummary {
	readonly count: number;
	readonly first: number;
	readonly last: number;
}

/**
 * 统计 (fromExclusive, toInclusive] 内本该触发的次数，用于「已错过」记录。
 * 高频计划（如每分钟）在长时间关机后可能很多次，只数到 cap 为止。
 */
export function summarizeFireTimes(
	schedule: AutomationSchedule,
	fromExclusive: number,
	toInclusive: number,
	cap = 100_000,
): FireWindowSummary | null {
	if (toInclusive <= fromExclusive) return null;
	if (schedule.kind === "once") {
		return schedule.at > fromExclusive && schedule.at <= toInclusive
			? { count: 1, first: schedule.at, last: schedule.at }
			: null;
	}
	if (schedule.kind === "interval") {
		const first = nextIntervalFire(schedule, fromExclusive);
		if (first > toInclusive) return null;
		const step = schedule.everyMinutes * 60_000;
		const count = Math.min(cap, Math.floor((toInclusive - first) / step) + 1);
		return { count, first, last: first + (count - 1) * step };
	}
	const cron = automationScheduleToCron(schedule);
	if (!cron || !isValidCronExpression(cron)) return null;
	const job = new Cron(cron, { paused: true, timezone: localTimezone() });
	let cursor = new Date(fromExclusive);
	let count = 0;
	let first = 0;
	let last = 0;
	while (count < cap) {
		const next = job.nextRun(cursor);
		if (!next || next.getTime() > toInclusive) break;
		if (count === 0) first = next.getTime();
		last = next.getTime();
		count++;
		cursor = next;
	}
	return count > 0 ? { count, first, last } : null;
}
