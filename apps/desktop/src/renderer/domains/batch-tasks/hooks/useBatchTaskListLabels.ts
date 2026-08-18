import type {
	BatchTaskCardLabels,
	BatchTaskGridLabels,
	BatchTaskProjectActionsLabels,
	BatchTaskProjectHeaderLabels,
} from "@vetta/theme-ui/batch-tasks";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";

export interface BatchTaskListLabels {
	actions: BatchTaskProjectActionsLabels;
	card: BatchTaskCardLabels;
	grid: BatchTaskGridLabels;
	header: BatchTaskProjectHeaderLabels;
}

export function useBatchTaskListLabels(): BatchTaskListLabels {
	const { t } = useTranslation("batch-tasks");

	return useMemo(
		() => ({
			card: {
				goToSession: t("actions.goToSession"),
				cancelWait: t("actions.cancelWait"),
				run: t("actions.run"),
				resume: t("actions.resume"),
				retry: t("actions.retry"),
				rerun: t("actions.rerun"),
				delete: t("actions.delete"),
				notRun: t("status.notRun"),
			},
			grid: {
				searchPlaceholder: t("list.searchPlaceholder"),
				clear: t("list.clear"),
				noMatch: (query) => t("list.noMatch", { query }),
				noTasks: t("list.noTasks"),
				expandMore: (n) => t("list.expandMore", { n }),
				collapse: t("list.collapse"),
			},
			header: {
				matchCount: (filtered, total) => t("list.matchCount", { filtered, total }),
				taskCount: (n) => t("list.taskCount", { n }),
				completedOf: (completed, total) => t("list.completedOf", { completed, total }),
				runningSuffix: (n) => t("list.runningSuffix", { n }),
				pausedSuffix: (n) => t("list.pausedSuffix", { n }),
				resetFailedHint: (n) => t("list.resetFailedHint", { n }),
				failedReset: (n) => t("list.failedReset", { n }),
			},
			actions: {
				stop: t("actions.stop"),
				start: t("actions.start"),
				allDone: t("actions.allDone"),
				allDoneOrFailed: (n) => t("actions.allDoneOrFailed", { n }),
				reset: t("actions.reset"),
				editProject: t("actions.editProject"),
				deleteProject: t("actions.deleteProject"),
			},
		}),
		[t],
	);
}
