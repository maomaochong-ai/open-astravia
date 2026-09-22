import type { AutomationMonthDay, AutomationSchedule, AutomationScheduleKind } from "../../../../../shared/automation";

export const SCHEDULE_KINDS: readonly AutomationScheduleKind[] = [
	"once",
	"interval",
	"hourly",
	"daily",
	"weekly",
	"monthly",
	"custom",
];

function timeOf(schedule: AutomationSchedule | undefined): { hour: number; minute: number } {
	if (schedule && "hour" in schedule) return { hour: schedule.hour, minute: schedule.minute };
	if (schedule?.kind === "once") {
		const date = new Date(schedule.at);
		return { hour: date.getHours(), minute: date.getMinutes() };
	}
	return { hour: 9, minute: 0 };
}

/** 切换档位时沿用上一个档位里的时刻，只换重复方式。 */
export function defaultScheduleFor(
	kind: AutomationScheduleKind,
	now: number,
	previous?: AutomationSchedule,
): AutomationSchedule {
	const { hour, minute } = timeOf(previous);
	switch (kind) {
		case "once": {
			const at = new Date(now);
			at.setHours(hour, minute, 0, 0);
			if (at.getTime() <= now) at.setDate(at.getDate() + 1);
			return { kind: "once", at: at.getTime() };
		}
		case "interval":
			return { kind: "interval", everyMinutes: 30, startAt: now };
		case "hourly":
			return { kind: "hourly", minute };
		case "daily":
			return { kind: "daily", hour, minute };
		case "weekly":
			return { kind: "weekly", weekdays: [new Date(now).getDay()], hour, minute };
		case "monthly":
			return { kind: "monthly", days: [new Date(now).getDate()], hour, minute };
		case "custom":
			return {
				kind: "custom",
				cron: previous ? (scheduleAsCron(previous) ?? `${minute} ${hour} * * *`) : "0 9 * * *",
			};
	}
}

function scheduleAsCron(schedule: AutomationSchedule): string | null {
	switch (schedule.kind) {
		case "once":
			return null;
		case "interval":
			// 只有整除一小时的间隔能写成 cron；其余没有等价表达，交给用户自己写。
			return 60 % schedule.everyMinutes === 0 ? `*/${schedule.everyMinutes} * * * *` : null;
		case "hourly":
			return `${schedule.minute} * * * *`;
		case "daily":
			return `${schedule.minute} ${schedule.hour} * * *`;
		case "weekly":
			return `${schedule.minute} ${schedule.hour} * * ${formatCronField(new Set(schedule.weekdays))}`;
		case "monthly":
			return `${schedule.minute} ${schedule.hour} ${schedule.days.map((day) => (day === "last" ? "L" : day)).join(",")} * *`;
		case "custom":
			return schedule.cron;
	}
}

export function pad2(value: number): string {
	return String(value).padStart(2, "0");
}

export function sortMonthDays(days: readonly AutomationMonthDay[]): AutomationMonthDay[] {
	return [...days].sort((a, b) => (a === "last" ? 32 : a) - (b === "last" ? 32 : b));
}

// ── 自定义：五段 cron 与可视化多选互相同步 ──────────────────────────────

export type CronFieldKey = "minute" | "hour" | "day" | "month" | "weekday";

export interface CronFieldSpec {
	readonly key: CronFieldKey;
	readonly min: number;
	readonly max: number;
}

export const CRON_FIELDS: readonly CronFieldSpec[] = [
	{ key: "minute", min: 0, max: 59 },
	{ key: "hour", min: 0, max: 23 },
	{ key: "day", min: 1, max: 31 },
	{ key: "month", min: 1, max: 12 },
	{ key: "weekday", min: 0, max: 6 },
];

/**
 * 单段 cron → 取值集合；"*" 返回 null（任意）。支持列表、区间与步长，
 * 展开后交给可视化多选；解析不了（如 L、W、?）返回 undefined，只能在文本模式编辑。
 */
export function parseCronField(field: string, spec: CronFieldSpec): ReadonlySet<number> | null | undefined {
	if (field === "*") return null;
	const values = new Set<number>();
	for (const part of field.split(",")) {
		const match = /^(\*|\d+)(?:-(\d+))?(?:\/(\d+))?$/.exec(part);
		if (!match) return undefined;
		const start = match[1] === "*" ? spec.min : Number(match[1]);
		const end = match[2] !== undefined ? Number(match[2]) : match[1] === "*" || match[3] ? spec.max : start;
		const step = match[3] !== undefined ? Number(match[3]) : 1;
		if (step < 1 || start < spec.min || end > spec.max + (spec.key === "weekday" ? 1 : 0) || start > end) {
			return undefined;
		}
		for (let value = start; value <= end; value += step) values.add(spec.key === "weekday" ? value % 7 : value);
	}
	return values;
}

/** 取值集合 → 单段 cron；连续值压成区间，便于阅读。 */
export function formatCronField(values: ReadonlySet<number> | null): string {
	if (!values || values.size === 0) return "*";
	const sorted = [...values].sort((a, b) => a - b);
	const parts: string[] = [];
	let start = sorted[0];
	let previous = sorted[0];
	for (const value of [...sorted.slice(1), Number.NaN]) {
		if (value === previous + 1) {
			previous = value;
			continue;
		}
		parts.push(
			previous - start >= 2 ? `${start}-${previous}` : start === previous ? `${start}` : `${start},${previous}`,
		);
		start = value;
		previous = value;
	}
	return parts.join(",");
}

export function splitCron(cron: string): string[] {
	return cron.trim().split(/\s+/);
}
