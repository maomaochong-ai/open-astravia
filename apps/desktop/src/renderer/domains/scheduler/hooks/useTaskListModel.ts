import type { ScheduledTask } from "@shared/store/atoms";
import {
	confirmDialogAtom,
	defaultConversationCwdAtom,
	getProjectDisplayName,
	runningTaskIdsAtom,
	scheduledTasksAtom,
} from "@shared/store/atoms";
import type { TFunction } from "i18next";
import { useAtomValue, useSetAtom } from "jotai";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { describeSchedule } from "../components/schedule-picker/describe-schedule";
import { useScheduledTasks } from "./useScheduledTasks";

export interface TaskListItemModel {
	readonly enabled: boolean;
	readonly id: string;
	readonly isRunning: boolean;
	readonly isSelected: boolean;
	readonly lastRunLabel: string;
	readonly lastRunStatus: "success" | "failed" | null;
	readonly name: string;
	readonly prompt: string;
	readonly scheduleLabel: string;
	readonly scheduleDetail: string | null;
	readonly statusLabel: string;
	readonly suspendedLabel: string | null;
	readonly targetLabel: string;
	readonly task: ScheduledTask;
}

export interface TaskListModel {
	readonly items: readonly TaskListItemModel[];
	readonly labels: {
		readonly delete: string;
		readonly edit: string;
		readonly enable: string;
		readonly failed: string;
		readonly pause: string;
		readonly runNow: string;
		readonly success: string;
	};
	readonly onDeleteTask: (taskId: string) => void;
	readonly onRunTask: (taskId: string) => void;
	readonly onToggleTask: (taskId: string) => void;
}

interface UseTaskListModelOptions {
	readonly selectedTaskId: string | null;
}

export function useTaskListModel({ selectedTaskId }: UseTaskListModelOptions): TaskListModel {
	const { t } = useTranslation("automation");
	const tasks = useAtomValue(scheduledTasksAtom);
	const runningTaskIds = useAtomValue(runningTaskIdsAtom);
	const defaultCwd = useAtomValue(defaultConversationCwdAtom);
	const setConfirmDialog = useSetAtom(confirmDialogAtom);
	const { deleteTask, toggleTask, runNow } = useScheduledTasks();

	return useMemo(
		() => ({
			items: tasks.map((task) => {
				const isRunning = runningTaskIds.has(task.id);
				return {
					enabled: task.enabled,
					id: task.id,
					isRunning,
					isSelected: selectedTaskId === task.id,
					lastRunLabel: formatLastRun(task.lastRunAt, t),
					lastRunStatus:
						task.lastRunStatus === "success" || task.lastRunStatus === "failed" ? task.lastRunStatus : null,
					name: task.name,
					prompt: task.prompt,
					scheduleLabel: describeSchedule(task.schedule, t),
					scheduleDetail: task.schedule.kind === "custom" ? task.schedule.cron : null,
					statusLabel: isRunning
						? t("list.running")
						: task.suspendedReason
							? t("list.suspended")
							: task.enabled
								? t("list.pending")
								: t("list.disabled"),
					suspendedLabel: task.suspendedReason ? t(`suspended.${task.suspendedReason}`) : null,
					targetLabel: t("list.target", {
						mode: t(`form.runMode.${task.runTarget.mode}`),
						project: getProjectDisplayName(task.runTarget.projectCwd, defaultCwd),
					}),
					task,
				};
			}),
			labels: {
				delete: t("list.delete"),
				edit: t("list.edit"),
				enable: t("list.enable"),
				failed: t("list.failed"),
				pause: t("list.pause"),
				runNow: t("list.runNow"),
				success: t("list.success"),
			},
			onDeleteTask: (taskId: string): void => {
				const task = tasks.find((candidate) => candidate.id === taskId);
				if (!task) return;
				setConfirmDialog({
					title: t("confirm.deleteTitle", { name: task.name }),
					message: t("confirm.deleteMsg"),
					confirmLabel: t("confirm.delete"),
					cancelLabel: t("confirm.cancel"),
					variant: "danger",
					onConfirm: () => deleteTask(task.id),
				});
			},
			onRunTask: (taskId: string): void => {
				void runNow(taskId);
			},
			onToggleTask: (taskId: string): void => {
				void toggleTask(taskId);
			},
		}),
		[defaultCwd, deleteTask, runNow, runningTaskIds, selectedTaskId, setConfirmDialog, t, tasks, toggleTask],
	);
}

function formatLastRun(timestamp: number | null, t: TFunction<"automation">): string {
	if (!timestamp) return t("list.neverRun");
	const diff = Date.now() - timestamp;
	if (diff < 60000) return t("list.justNow");
	if (diff < 3600000) return t("list.minutesAgo", { n: Math.floor(diff / 60000) });
	if (diff < 86400000) return t("list.hoursAgo", { n: Math.floor(diff / 3600000) });
	return t("list.daysAgo", { n: Math.floor(diff / 86400000) });
}
