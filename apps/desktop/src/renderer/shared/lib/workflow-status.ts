import type { SubagentTask } from "@shared/store/atoms";
import type { TFunction } from "i18next";

export interface WorkflowStatusMeta {
	icon: string;
	label: string;
	className: string;
}

/** i18n keys live in the chat namespace under activityPanel.workflow.* */
export function workflowStatusMeta(status: SubagentTask["status"], t: TFunction<"chat">): WorkflowStatusMeta {
	switch (status) {
		case "queued":
			return {
				icon: "icon-[solar--inbox-linear]",
				label: t("activityPanel.workflow.statusQueued"),
				className: "text-muted-foreground",
			};
		case "pending":
			return {
				icon: "icon-[solar--clock-circle-linear]",
				label: t("activityPanel.workflow.statusPending"),
				className: "text-muted-foreground",
			};
		case "running":
			return {
				icon: "icon-[solar--refresh-linear] animate-spin",
				label: t("activityPanel.workflow.statusRunning"),
				className: "text-emerald-400",
			};
		case "completed":
			return {
				icon: "icon-[solar--check-circle-linear]",
				label: t("activityPanel.workflow.statusCompleted"),
				className: "text-emerald-400",
			};
		case "failed":
			return {
				icon: "icon-[solar--danger-circle-linear]",
				label: t("activityPanel.workflow.statusFailed"),
				className: "text-destructive",
			};
		case "interrupted":
			return {
				icon: "icon-[solar--stop-circle-linear]",
				label: t("activityPanel.workflow.statusInterrupted"),
				className: "text-muted-foreground",
			};
	}
}

/** "done/total" progress label; empty string when the workflow has no todos. */
export function workflowProgressLabel(task: SubagentTask): string {
	const progress = task.todoProgress;
	if (!progress || progress.total === 0) return "";
	return `${progress.done}/${progress.total}`;
}
