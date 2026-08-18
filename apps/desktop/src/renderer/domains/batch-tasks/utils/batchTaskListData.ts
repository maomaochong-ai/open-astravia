import type { BatchTask } from "@shared/store/atoms";
import type { TFunction } from "i18next";
import type { ProjectCounts } from "../hooks/useBatchTaskListModel";

export const TASK_COLLAPSE_THRESHOLD = 9;

export function taskSortRank(status: BatchTask["status"]): number {
	if (status === "running") return 2;
	if (status === "paused") return 1;
	return 0;
}

export function sortTasks(tasks: BatchTask[]): BatchTask[] {
	return [...tasks].sort((a, b) => {
		const rankDiff = taskSortRank(b.status) - taskSortRank(a.status);
		if (rankDiff !== 0) return rankDiff;
		return b.createdAt - a.createdAt;
	});
}

export function relativeTime(timestamp: number, t: TFunction<"batch-tasks">): string {
	const now = Date.now();
	const diff = now - timestamp;
	const minutes = Math.floor(diff / 60_000);
	if (minutes < 1) return t("time.justNow");
	if (minutes < 60) return t("time.minutes", { n: minutes });
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return t("time.hours", { n: hours });
	const days = Math.floor(hours / 24);
	if (days < 7) return t("time.days", { n: days });
	return t("time.weeks", { n: Math.floor(days / 7) });
}

export function statusLabel(status: BatchTask["status"], hasSession: boolean, t: TFunction<"batch-tasks">): string {
	if (status === "pending") {
		return hasSession ? t("status.waiting") : t("status.notRun");
	}
	const labels: Record<Exclude<BatchTask["status"], "pending">, string> = {
		running: t("status.running"),
		completed: t("status.completed"),
		failed: t("status.failed"),
		paused: t("status.paused"),
	};
	return labels[status];
}

export function computeCounts(tasks: BatchTask[]): ProjectCounts {
	let failed = 0;
	let running = 0;
	let completed = 0;
	let paused = 0;
	let neverExecuted = 0;
	for (const task of tasks) {
		switch (task.status) {
			case "failed":
				failed++;
				break;
			case "running":
				running++;
				break;
			case "completed":
				completed++;
				break;
			case "paused":
				paused++;
				break;
			case "pending":
				if (!task.sessionId) neverExecuted++;
				break;
		}
	}
	return { failed, running, completed, paused, neverExecuted, total: tasks.length };
}
