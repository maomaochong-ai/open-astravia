import type { BatchTask } from "@shared/store/atoms";
import type { BatchTaskCardLabels, BatchTaskViewItem } from "@vetta/theme-ui/batch-tasks";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { relativeTime, statusLabel } from "../utils/batchTaskListData";
import { useBatchTaskListLabels } from "./useBatchTaskListLabels";

export interface BatchTaskCardModel {
	labels: BatchTaskCardLabels;
	task: BatchTaskViewItem;
}

export function useBatchTaskCardModel(task: BatchTask, isQueued: boolean): BatchTaskCardModel {
	const { t } = useTranslation("batch-tasks");
	const { card } = useBatchTaskListLabels();

	const viewTask = useMemo<BatchTaskViewItem>(
		() => ({
			id: task.id,
			name: task.name,
			status: task.status,
			statusLabel: isQueued ? t("status.waiting") : statusLabel(task.status, Boolean(task.sessionId), t),
			timeLabel: task.sessionId ? relativeTime(task.updatedAt, t) : null,
			error: task.error,
			sessionPath: task.sessionPath,
			isQueued,
		}),
		[isQueued, t, task],
	);

	return { labels: card, task: viewTask };
}
