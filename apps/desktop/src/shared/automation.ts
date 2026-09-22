/**
 * 自动化（定时任务）的共享数据模型，main / preload / renderer 共用一份定义（ADR-0127）。
 *
 * 这里只放结构与纯函数：调度、执行、存储分别在 main/scheduler 下实现。
 */

/** 「重复」：精确到分钟；星期 0 = 周日，与 cron 一致。 */
export type AutomationSchedule =
	| { readonly kind: "once"; readonly at: number }
	| { readonly kind: "hourly"; readonly minute: number }
	| { readonly kind: "daily"; readonly hour: number; readonly minute: number }
	| { readonly kind: "weekly"; readonly weekdays: readonly number[]; readonly hour: number; readonly minute: number }
	| {
			readonly kind: "monthly";
			readonly days: readonly AutomationMonthDay[];
			readonly hour: number;
			readonly minute: number;
	  }
	| { readonly kind: "custom"; readonly cron: string };

export type AutomationScheduleKind = AutomationSchedule["kind"];

/** 每月的几号；"last" 表示当月最后一天。 */
export type AutomationMonthDay = number | "last";

/**
 * 运行会话策略（CONTEXT.md「运行会话策略」）。
 *
 * projectCwd 是会话落在侧边栏的哪个项目下：「对话」即默认对话 cwd。
 * same-session 的 sessionPath 为 null 表示「开启一个新会话」且尚未首次落盘；
 * 首次执行成功落盘后回写，之后一直复用。
 */
export type AutomationRunTarget =
	| { readonly mode: "new-session"; readonly projectCwd: string }
	| { readonly mode: "same-session"; readonly projectCwd: string; readonly sessionPath: string | null };

export type AutomationRunTargetMode = AutomationRunTarget["mode"];

/** 显式选择的模型；缺省即「跟随默认」，每次触发时解析。 */
export interface AutomationModel {
	readonly key: string;
	readonly reasoning?: string;
}

export type AutomationNotifyWhen = "always" | "success" | "failure";

export interface AutomationNotification {
	readonly webhookIds: readonly string[];
	readonly when: AutomationNotifyWhen;
	/** 支持 {{name}} {{status}} {{startedAt}} {{duration}} {{reply}} {{error}} 变量。 */
	readonly template: string;
}

/** 目标失效导致的暂停原因；用户修正目标并重新启用后清除。 */
export type AutomationSuspendReason = "session-deleted" | "project-removed";

export interface ScheduledTask {
	readonly id: string;
	readonly name: string;
	readonly prompt: string;
	readonly schedule: AutomationSchedule;
	readonly runTarget: AutomationRunTarget;
	readonly model?: AutomationModel;
	readonly notification?: AutomationNotification;
	readonly enabled: boolean;
	readonly suspendedReason?: AutomationSuspendReason;
	readonly createdAt: number;
	readonly updatedAt: number;
	readonly lastRunAt: number | null;
	readonly lastRunStatus: "success" | "failed" | null;
}

export type AutomationTaskInput = Pick<
	ScheduledTask,
	"name" | "prompt" | "schedule" | "runTarget" | "model" | "notification" | "enabled"
>;

export type AutomationTaskPatch = {
	readonly [Key in keyof AutomationTaskInput]?: Key extends "model" | "notification"
		? AutomationTaskInput[Key] | null
		: AutomationTaskInput[Key];
};

export type AutomationRecordStatus = "running" | "success" | "failed" | "aborted" | "skipped" | "missed";

/** 未执行的原因：skipped 只会是 previous-running；missed 是应用未运行或系统休眠。 */
export type AutomationNotRunReason = "previous-running" | "app-not-running" | "system-sleep";

export interface TaskExecutionRecord {
	readonly id: string;
	readonly taskId: string;
	/** 未执行（skipped / missed）的记录没有会话。 */
	readonly sessionId?: string;
	readonly sessionPath?: string;
	readonly cwd?: string;
	/** 执行时的运行会话策略；缺省视为 new-session（重新设计前的记录）。 */
	readonly mode?: AutomationRunTargetMode;
	readonly startedAt: number;
	readonly completedAt: number | null;
	readonly status: AutomationRecordStatus;
	readonly prompt: string;
	readonly responsePreview: string;
	readonly error?: string;
	readonly durationMs?: number;
	readonly reason?: AutomationNotRunReason;
	/** missed 记录合并了连续错过的次数；startedAt 为首次错过时刻，missedUntil 为最后一次。 */
	readonly missedCount?: number;
	readonly missedUntil?: number;
	/** webhook 发送失败的说明；不影响执行状态本身。 */
	readonly notifyError?: string;
}

/** 侧边栏据此把会话归入自动化（会话组 / 定时标记）。 */
export interface AutomationSessionLink {
	readonly sessionPath: string;
	readonly taskId: string;
	readonly taskName: string;
	readonly mode: AutomationRunTargetMode;
}

export type AutomationTaskEvent =
	| {
			readonly type: "task.started";
			readonly taskId: string;
			readonly taskName: string;
			readonly recordId: string;
			readonly sessionId: string;
			readonly sessionPath: string;
			/** 侧边栏的分桶 cwd（项目根或默认对话根）。 */
			readonly listCwd: string;
			readonly sessionName: string;
			readonly firstMessage: string;
			readonly mode: AutomationRunTargetMode;
	  }
	| { readonly type: "record.updated"; readonly taskId: string }
	| { readonly type: "tasks.changed" };

export const AUTOMATION_TEMPLATE_VARIABLES = ["name", "status", "startedAt", "duration", "reply", "error"] as const;
export type AutomationTemplateVariable = (typeof AUTOMATION_TEMPLATE_VARIABLES)[number];

/** 把 {{var}} 替换为对应值；未知变量原样保留，方便用户发现拼写错误。 */
export function renderAutomationTemplate(
	template: string,
	values: Readonly<Record<AutomationTemplateVariable, string>>,
): string {
	return template.replace(/\{\{\s*([a-zA-Z]+)\s*\}\}/g, (match, key: string) =>
		(AUTOMATION_TEMPLATE_VARIABLES as readonly string[]).includes(key)
			? values[key as AutomationTemplateVariable]
			: match,
	);
}

/** 非 once 的计划对应的 5 段 cron；once 以绝对时刻调度，返回 null。 */
export function automationScheduleToCron(schedule: AutomationSchedule): string | null {
	switch (schedule.kind) {
		case "once":
			return null;
		case "hourly":
			return `${schedule.minute} * * * *`;
		case "daily":
			return `${schedule.minute} ${schedule.hour} * * *`;
		case "weekly":
			return `${schedule.minute} ${schedule.hour} * * ${[...schedule.weekdays].sort((a, b) => a - b).join(",")}`;
		case "monthly":
			return `${schedule.minute} ${schedule.hour} ${sortMonthDays(schedule.days)
				.map((day) => (day === "last" ? "L" : String(day)))
				.join(",")} * *`;
		case "custom":
			return schedule.cron.trim();
	}
}

function sortMonthDays(days: readonly AutomationMonthDay[]): AutomationMonthDay[] {
	return [...days].sort((a, b) => (a === "last" ? 32 : a) - (b === "last" ? 32 : b));
}

function isInteger(value: unknown, min: number, max: number): value is number {
	return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
}

/** 结构校验（不含 cron 语法，cron 由 main 用调度引擎校验）。 */
export function isAutomationSchedule(value: unknown): value is AutomationSchedule {
	if (!value || typeof value !== "object") return false;
	const schedule = value as Record<string, unknown>;
	const hasOnly = (...keys: string[]) => Object.keys(schedule).every((key) => key === "kind" || keys.includes(key));
	switch (schedule.kind) {
		case "once":
			return hasOnly("at") && typeof schedule.at === "number" && Number.isFinite(schedule.at);
		case "hourly":
			return hasOnly("minute") && isInteger(schedule.minute, 0, 59);
		case "daily":
			return hasOnly("hour", "minute") && isInteger(schedule.hour, 0, 23) && isInteger(schedule.minute, 0, 59);
		case "weekly":
			return (
				hasOnly("weekdays", "hour", "minute") &&
				Array.isArray(schedule.weekdays) &&
				schedule.weekdays.length > 0 &&
				schedule.weekdays.every((day) => isInteger(day, 0, 6)) &&
				isInteger(schedule.hour, 0, 23) &&
				isInteger(schedule.minute, 0, 59)
			);
		case "monthly":
			return (
				hasOnly("days", "hour", "minute") &&
				Array.isArray(schedule.days) &&
				schedule.days.length > 0 &&
				schedule.days.every((day) => day === "last" || isInteger(day, 1, 31)) &&
				isInteger(schedule.hour, 0, 23) &&
				isInteger(schedule.minute, 0, 59)
			);
		case "custom":
			return hasOnly("cron") && typeof schedule.cron === "string" && schedule.cron.trim().split(/\s+/).length === 5;
		default:
			return false;
	}
}

export function isAutomationRunTarget(value: unknown): value is AutomationRunTarget {
	if (!value || typeof value !== "object") return false;
	const target = value as Record<string, unknown>;
	if (typeof target.projectCwd !== "string" || target.projectCwd.trim().length === 0) return false;
	if (target.mode === "new-session") return Object.keys(target).every((key) => key === "mode" || key === "projectCwd");
	if (target.mode === "same-session") {
		return (
			Object.keys(target).every((key) => key === "mode" || key === "projectCwd" || key === "sessionPath") &&
			(target.sessionPath === null || (typeof target.sessionPath === "string" && target.sessionPath.length > 0))
		);
	}
	return false;
}

export function isAutomationModel(value: unknown): value is AutomationModel {
	if (!value || typeof value !== "object") return false;
	const model = value as Record<string, unknown>;
	return (
		Object.keys(model).every((key) => key === "key" || key === "reasoning") &&
		typeof model.key === "string" &&
		model.key.trim().length > 0 &&
		(model.reasoning === undefined || (typeof model.reasoning === "string" && model.reasoning.length > 0))
	);
}

export function isAutomationNotification(value: unknown): value is AutomationNotification {
	if (!value || typeof value !== "object") return false;
	const notification = value as Record<string, unknown>;
	return (
		Object.keys(notification).every((key) => key === "webhookIds" || key === "when" || key === "template") &&
		Array.isArray(notification.webhookIds) &&
		notification.webhookIds.length > 0 &&
		notification.webhookIds.every((id) => typeof id === "string" && id.length > 0) &&
		(notification.when === "always" || notification.when === "success" || notification.when === "failure") &&
		typeof notification.template === "string" &&
		notification.template.trim().length > 0
	);
}
