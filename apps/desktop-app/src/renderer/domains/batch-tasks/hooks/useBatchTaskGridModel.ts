import type { BatchTask } from "@shared/store/atoms";
import type { BatchTaskCardLabels, BatchTaskGridLabels, BatchTaskViewItem } from "@vetta/theme-ui/batch-tasks";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { relativeTime, statusLabel } from "../utils/batchTaskListData";
import { useBatchTaskListLabels } from "./useBatchTaskListLabels";

export interface BatchTaskGridModel {
	cardLabels: BatchTaskCardLabels;
	labels: BatchTaskGridLabels;
	visibleTasks: BatchTaskViewItem[];
}

export function useBatchTaskGridModel(visibleTasks: BatchTask[], queuedTaskIds: Set<string>): BatchTaskGridModel {
	const { t } = useTranslation("batch-tasks");
	const labels = useBatchTaskListLabels();

	const viewTasks = useMemo(
		() =>
			visibleTasks.map((task): BatchTaskViewItem => {
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
			}),
		[queuedTaskIds, t, visibleTasks],
	);

	return {
		cardLabels: labels.card,
		labels: labels.grid,
		visibleTasks: viewTasks,
	};
}
