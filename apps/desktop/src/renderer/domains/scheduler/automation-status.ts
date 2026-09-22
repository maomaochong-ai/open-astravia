import type { ScheduledTask } from "../../../shared/automation";

/** 列表与分屏共用的任务状态：done 是一次性任务已跑完、自动停用。 */
export type AutomationTaskTone = "active" | "running" | "paused" | "suspended" | "done";

export type AutomationListFilter = "all" | "enabled" | "paused" | "done";

export const AUTOMATION_LIST_FILTERS: readonly AutomationListFilter[] = ["all", "enabled", "paused", "done"];

export function automationTaskTone(task: ScheduledTask, running: boolean): AutomationTaskTone {
	if (running) return "running";
	if (task.suspendedReason) return "suspended";
	if (task.enabled) return "active";
	return task.schedule.kind === "once" && task.lastRunAt !== null ? "done" : "paused";
}

export function matchesAutomationFilter(tone: AutomationTaskTone, filter: AutomationListFilter): boolean {
	switch (filter) {
		case "all":
			return true;
		case "enabled":
			return tone === "active" || tone === "running";
		case "paused":
			return tone === "paused" || tone === "suspended";
		case "done":
			return tone === "done";
	}
}
