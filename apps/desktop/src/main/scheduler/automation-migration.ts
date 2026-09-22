import type { AutomationMonthDay, AutomationSchedule, ScheduledTask } from "../../shared/automation.js";
import { nextFireTime } from "./cron.js";

/** 重新设计前（ADR-0127 之前）写入 scheduled-tasks.json 的任务形状。 */
export interface LegacyScheduledTask {
	id: string;
	name: string;
	prompt: string;
	cron: string;
	isOnce?: boolean;
	enabled: boolean;
	cwd?: string;
	modelKey?: string;
	executionMode?: string;
	skill?: { name: string; alias?: string; type: "skill" | "scene" };
	createdAt: number;
	updatedAt: number;
	lastRunAt: number | null;
	lastRunStatus: "success" | "failed" | null;
}

export interface LegacyMigrationContext {
	readonly conversationCwd: string;
	readonly isKnownProject: (cwd: string) => boolean;
	readonly now: number;
}

const FIELD = String.raw`(\d{1,2})`;
const LIST = String.raw`(\d{1,2}(?:,\d{1,2})*)`;

/** 旧 cron 能对上新档位就还原成档位，对不上的归入「自定义」。 */
export function legacyCronToSchedule(cron: string, isOnce: boolean, now: number): AutomationSchedule {
	const expression = cron.trim().replace(/\s+/g, " ");
	if (isOnce) {
		const once = new RegExp(`^${FIELD} ${FIELD} ${FIELD} ${FIELD} \\*$`).exec(expression);
		if (once) {
			const [, minute, hour, day, month] = once.map(Number);
			// 旧的一次性 cron 不带年份，会逐年重复匹配；取下一次匹配时刻，
			// 已停用的任务取今年的那一刻，保持历史语义不漂移。
			const next = nextFireTime({ kind: "custom", cron: expression }, now);
			const thisYear = new Date(new Date(now).getFullYear(), month - 1, day, hour, minute).getTime();
			return { kind: "once", at: next ?? thisYear };
		}
	}
	const hourly = new RegExp(`^${FIELD} \\* \\* \\* \\*$`).exec(expression);
	if (hourly) return { kind: "hourly", minute: Number(hourly[1]) };
	const daily = new RegExp(`^${FIELD} ${FIELD} \\* \\* \\*$`).exec(expression);
	if (daily) return { kind: "daily", hour: Number(daily[2]), minute: Number(daily[1]) };
	const weekly = new RegExp(`^${FIELD} ${FIELD} \\* \\* ${LIST}$`).exec(expression);
	if (weekly) {
		const weekdays = [...new Set(weekly[3].split(",").map((day) => Number(day) % 7))];
		return { kind: "weekly", weekdays, hour: Number(weekly[2]), minute: Number(weekly[1]) };
	}
	const monthly = new RegExp(`^${FIELD} ${FIELD} ${LIST} \\* \\*$`).exec(expression);
	if (monthly) {
		const days: AutomationMonthDay[] = [...new Set(monthly[3].split(",").map(Number))];
		return { kind: "monthly", days, hour: Number(monthly[2]), minute: Number(monthly[1]) };
	}
	return { kind: "custom", cron: expression };
}

function quoteTokenName(name: string): string {
	return /^[^\s"]+$/.test(name) ? name : `"${name.replace(/"/g, "")}"`;
}

/**
 * 旧任务 → 新结构：策略一律「每次新建会话」；项目由旧 cwd 推断，认不出就落「对话」；
 * 技能引用转为正文开头的行内 token；执行权限字段丢弃（自动化固定完全访问）。
 */
export function migrateLegacyTask(legacy: LegacyScheduledTask, context: LegacyMigrationContext): ScheduledTask {
	const projectCwd = legacy.cwd && context.isKnownProject(legacy.cwd) ? legacy.cwd : context.conversationCwd;
	const skillToken = legacy.skill ? `@${legacy.skill.type}:${quoteTokenName(legacy.skill.name)} ` : "";
	const schedule = legacyCronToSchedule(legacy.cron, legacy.isOnce === true, context.now);
	return {
		id: legacy.id,
		name: legacy.name,
		prompt: `${skillToken}${legacy.prompt}`,
		schedule,
		runTarget: { mode: "new-session", projectCwd },
		...(legacy.modelKey ? { model: { key: legacy.modelKey } } : {}),
		// 过期的一次性任务不再有下一次，迁移后保持停用。
		enabled: legacy.enabled && (schedule.kind !== "once" || schedule.at > context.now),
		createdAt: legacy.createdAt,
		updatedAt: legacy.updatedAt,
		lastRunAt: legacy.lastRunAt,
		lastRunStatus: legacy.lastRunStatus,
	};
}
