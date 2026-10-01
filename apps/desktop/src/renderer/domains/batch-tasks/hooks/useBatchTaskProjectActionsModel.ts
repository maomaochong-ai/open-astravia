import type { BatchTaskProjectActionsLabels } from "@astravia-org/theme-ui/batch-tasks";
import type { BatchProject } from "@shared/store/atoms";
import { useBatchTaskListLabels } from "./useBatchTaskListLabels";

export interface BatchTaskProjectActionsModel {
	hasQueued: boolean;
	labels: BatchTaskProjectActionsLabels;
}

export function useBatchTaskProjectActionsModel(
	project: BatchProject,
	queuedTaskIds: Set<string>,
): BatchTaskProjectActionsModel {
	const { actions } = useBatchTaskListLabels();
	const hasQueued = project.tasks.some((task) => queuedTaskIds.has(task.id));
	return { hasQueued, labels: actions };
}
