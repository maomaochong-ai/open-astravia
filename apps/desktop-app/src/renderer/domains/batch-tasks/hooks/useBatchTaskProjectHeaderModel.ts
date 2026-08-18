import type { BatchTaskProjectHeaderLabels } from "@vetta/theme-ui/batch-tasks";
import { useBatchTaskListLabels } from "./useBatchTaskListLabels";

export interface BatchTaskProjectHeaderModel {
	labels: BatchTaskProjectHeaderLabels;
}

export function useBatchTaskProjectHeaderModel(): BatchTaskProjectHeaderModel {
	const { header } = useBatchTaskListLabels();
	return { labels: header };
}
