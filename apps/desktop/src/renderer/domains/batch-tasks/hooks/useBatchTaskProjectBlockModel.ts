import type { BatchProject } from "@shared/store/atoms";
import type {
	BatchProjectCountsView,
	BatchTaskProjectBlockCallbacks,
	BatchTaskViewItem,
} from "@vetta/theme-ui/batch-tasks";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { computeCounts, relativeTime, sortTasks, statusLabel } from "../utils/batchTaskListData";
import { useBatchTaskListLabels } from "./useBatchTaskListLabels";
import type { BatchTaskListActions } from "./useBatchTaskListModel";

export interface BatchTaskProjectBlockModel {
	actionsLabels: ReturnType<typeof useBatchTaskListLabels>["actions"];
	cardLabels: ReturnType<typeof useBatchTaskListLabels>["card"];
	callbacks: BatchTaskProjectBlockCallbacks;
	counts: BatchProjectCountsView;
	gridLabels: ReturnType<typeof useBatchTaskListLabels>["grid"];
	hasQueued: boolean;
	headerLabels: ReturnType<typeof useBatchTaskListLabels>["header"];
	projectName: string;
	tasks: BatchTaskViewItem[];
}

export function useBatchTaskProjectBlockModel(
	project: BatchProject,
	actions: BatchTaskListActions,
	queuedTaskIds: Set<string>,
	onEditProject: (project: BatchProject) => void,
): BatchTaskProjectBlockModel {
	const { t } = useTranslation("batch-tasks");
	const labels = useBatchTaskListLabels();
	const counts = useMemo(() => computeCounts(project.tasks), [project.tasks]);
	const hasQueued = project.tasks.some((task) => queuedTaskIds.has(task.id));

	const tasks = useMemo(() => {
		const sorted = sortTasks(project.tasks);
		return sorted.map((task): BatchTaskViewItem => {
			const isQueued = queuedTaskIds.has(task.id);
			return {
				id: task.id,
				name: task.name,
				status: task.status,
				statusLabel: isQueued ? t("status.waiting") : statusLabel(task.status, Boolean(task.sessionId), t),
				timeLabel: task.sessionId ? relativeTime(task.updatedAt, t) : null,
				error: task.error,
				sessionPath: task.sessionPath,
				isQueued,
			};
		});
	}, [project.tasks, queuedTaskIds, t]);

	const taskById = useMemo(() => new Map(project.tasks.map((task) => [task.id, task])), [project.tasks]);

	const callbacks = useMemo<BatchTaskProjectBlockCallbacks>(
		() => ({
			batchReset: () => actions.batchReset(project),
			batchStart: () => actions.batchStart(project, counts),
			batchStop: () => actions.batchStop(project, counts),
			deleteProject: () => actions.deleteProject(project),
			editProject: () => onEditProject(project),
			resetFailed: () => actions.resetFailed(project, counts),
			deleteTask: (taskId) => {
				const task = taskById.get(taskId);
				if (task) actions.deleteTask(project, task);
			},
			goToSession: (taskId) => {
				const task = taskById.get(taskId);
				if (task) actions.goToSession(task);
			},
			resume: (taskId) => actions.resumeTask(project.id, taskId),
			retry: (taskId) => {
				const task = taskById.get(taskId);
				if (task) actions.retryTask(project, task);
			},
			run: (taskId) => actions.runTask(project.id, taskId),
			stop: (taskId) => actions.stopTask(project.id, taskId),
		}),
		[actions, counts, onEditProject, project, taskById],
	);

	return {
		actionsLabels: labels.actions,
		cardLabels: labels.card,
		callbacks,
		counts,
		gridLabels: labels.grid,
		hasQueued,
		headerLabels: labels.header,
		projectName: project.name,
		tasks,
	};
}
