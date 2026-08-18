import type { BatchProject, BatchTask } from "@shared/store/atoms";
import { batchQueuedTaskIdsAtom, confirmDialogAtom, openSessionFnRef } from "@shared/store/atoms";
import { useAtomValue, useSetAtom } from "jotai";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useBatchTasks } from "./useBatchTasks";

export interface ProjectCounts {
	failed: number;
	running: number;
	completed: number;
	paused: number;
	neverExecuted: number;
	total: number;
}

export interface BatchTaskListActions {
	batchReset: (project: BatchProject) => void;
	batchStart: (project: BatchProject, counts: ProjectCounts) => void;
	batchStop: (project: BatchProject, counts: ProjectCounts) => void;
	deleteProject: (project: BatchProject) => void;
	deleteTask: (project: BatchProject, task: BatchTask) => void;
	goToSession: (task: BatchTask) => void;
	resetFailed: (project: BatchProject, counts: ProjectCounts) => void;
	resumeTask: (projectId: string, taskId: string) => void;
	retryTask: (project: BatchProject, task: BatchTask) => void;
	runTask: (projectId: string, taskId: string) => void;
	stopTask: (projectId: string, taskId: string) => void;
}

export interface BatchTaskListModel {
	actions: BatchTaskListActions;
	projects: BatchProject[];
	queuedTaskIds: Set<string>;
}

function projectSortRank(project: BatchProject): number {
	return project.tasks.some((task) => task.status === "running" || task.status === "paused") ? 1 : 0;
}

function sortProjects(projects: BatchProject[]): BatchProject[] {
	return [...projects].sort((a, b) => {
		const activeDiff = projectSortRank(b) - projectSortRank(a);
		if (activeDiff !== 0) return activeDiff;
		return b.createdAt - a.createdAt;
	});
}

export function useBatchTaskListModel(projects: BatchProject[]): BatchTaskListModel {
	const { t } = useTranslation("batch-tasks");
	const setConfirm = useSetAtom(confirmDialogAtom);
	const queuedTaskIds = useAtomValue(batchQueuedTaskIdsAtom);
	const {
		runTask,
		retryTask,
		stopTask,
		resumeTask,
		deleteTask,
		batchStart,
		batchStop,
		batchReset,
		batchResetFailed,
		deleteProject,
	} = useBatchTasks();
	const sortedProjects = useMemo(() => sortProjects(projects), [projects]);

	return {
		actions: {
			batchReset: (project) => {
				setConfirm({
					title: t("confirm.resetTitle"),
					message: t("confirm.resetMsg", { n: project.tasks.length }),
					confirmLabel: t("confirm.reset"),
					cancelLabel: t("confirm.cancel"),
					variant: "danger",
					onConfirm: async () => {
						await batchReset(project.id);
					},
				});
			},
			batchStart: (project, counts) => {
				if (counts.neverExecuted === 0 && counts.paused === 0) return;
				const parts: string[] = [];
				if (counts.neverExecuted > 0) parts.push(t("confirm.partNeverExecuted", { n: counts.neverExecuted }));
				if (counts.paused > 0) parts.push(t("confirm.partPaused", { n: counts.paused }));
				setConfirm({
					title: t("confirm.startTitle"),
					message: t("confirm.startMsg", { parts: parts.join(t("confirm.partJoin")) }),
					confirmLabel: t("confirm.start"),
					onConfirm: async () => {
						await batchStart(project.id);
					},
				});
			},
			batchStop: (project, counts) => {
				const targetCount = counts.total - counts.completed;
				if (targetCount === 0) return;
				setConfirm({
					title: t("confirm.stopTitle"),
					message: t("confirm.stopMsg", { running: counts.running, target: targetCount }),
					confirmLabel: t("confirm.stop"),
					cancelLabel: t("confirm.cancel"),
					variant: "danger",
					onConfirm: async () => {
						await batchStop(project.id);
					},
				});
			},
			deleteProject: (project) => {
				const runningCount = project.tasks.filter((task) => task.status === "running").length;
				if (runningCount > 0) {
					setConfirm({
						title: t("confirm.cannotDeleteTitle"),
						message: t("confirm.cannotDeleteMsg"),
						confirmLabel: t("confirm.ok"),
						onConfirm: () => {},
					});
					return;
				}
				setConfirm({
					title: t("confirm.deleteProjectTitle", { name: project.name }),
					message: t("confirm.deleteProjectMsg"),
					confirmLabel: t("confirm.delete"),
					cancelLabel: t("confirm.cancel"),
					variant: "danger",
					onConfirm: async () => {
						await deleteProject(project.id);
					},
				});
			},
			deleteTask: (project, task) => {
				if (task.status === "running") return;
				setConfirm({
					title: t("confirm.deleteTaskTitle"),
					message: t("confirm.deleteTaskMsg"),
					confirmLabel: t("confirm.delete"),
					cancelLabel: t("confirm.cancel"),
					variant: "danger",
					onConfirm: async () => {
						await deleteTask(project.id, task.id);
					},
				});
			},
			goToSession: (task) => {
				if (task.sessionPath && openSessionFnRef.current) {
					void openSessionFnRef.current(task.cwd, task.sessionPath, task.executionMode);
				}
			},
			resetFailed: (project, counts) => {
				if (counts.failed === 0) return;
				const failedIds = project.tasks.filter((task) => task.status === "failed").map((task) => task.id);
				if (failedIds.length === 0) return;
				const queueActive = project.tasks.some((task) => task.status === "running" || queuedTaskIds.has(task.id));
				const message = queueActive
					? t("confirm.resetFailedQueueActive", { n: failedIds.length })
					: t("confirm.resetFailedIdle", { n: failedIds.length });
				setConfirm({
					title: t("confirm.resetFailedTitle"),
					message,
					confirmLabel: t("confirm.reset"),
					cancelLabel: t("confirm.cancel"),
					variant: "danger",
					onConfirm: async () => {
						await batchResetFailed(project.id, failedIds);
					},
				});
			},
			resumeTask: (projectId, taskId) => {
				void resumeTask(projectId, taskId);
			},
			retryTask: (project, task) => {
				const isCompleted = task.status === "completed";
				setConfirm({
					title: isCompleted
						? t("confirm.rerunTitle", { name: task.name })
						: t("confirm.retryTitle", { name: task.name }),
					message: isCompleted ? t("confirm.rerunMsg") : t("confirm.retryMsg"),
					confirmLabel: isCompleted ? t("confirm.rerun") : t("confirm.retry"),
					cancelLabel: t("confirm.cancel"),
					variant: isCompleted ? undefined : "danger",
					onConfirm: async () => {
						await retryTask(project.id, task.id);
					},
				});
			},
			runTask: (projectId, taskId) => {
				void runTask(projectId, taskId);
			},
			stopTask: (projectId, taskId) => {
				void stopTask(projectId, taskId);
			},
		},
		projects: sortedProjects,
		queuedTaskIds,
	};
}
