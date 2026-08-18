import type { BatchProject, BatchTask, SessionExecutionMode } from "@shared/store/atoms";
import type { BatchProjectGroupLabels, BatchProjectGroupTaskItem } from "@vetta/theme-ui/batch-tasks";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { relativeTime } from "../utils/batchTaskListData";

export interface BatchProjectGroupModel {
	labels: BatchProjectGroupLabels;
	sessionCount: number;
	tasks: BatchProjectGroupTaskItem[];
}

export function useBatchProjectGroupModel(input: {
	activeSessionPath?: string;
	onSelectSession: (cwd: string, sessionPath: string, executionMode?: SessionExecutionMode) => void;
	project: BatchProject;
	tasks: BatchTask[];
}): BatchProjectGroupModel {
	const { t } = useTranslation("batch-tasks");
	const labels = useMemo(() => ({ badge: t("group.badge") }), [t]);

	const tasksWithSession = useMemo(() => input.tasks.filter((task) => task.sessionPath), [input.tasks]);

	const tasks = useMemo(
		() =>
			tasksWithSession.map(
				(task): BatchProjectGroupTaskItem => ({
					id: task.id,
					name: task.name || task.id,
					timeLabel: relativeTime(task.updatedAt, t),
					isActive: input.activeSessionPath === task.sessionPath,
					onSelect: () => {
						if (task.sessionPath) {
							input.onSelectSession(task.cwd, task.sessionPath, task.executionMode);
						}
					},
				}),
			),
		[input, t, tasksWithSession],
	);

	return {
		labels,
		sessionCount: tasksWithSession.length,
		tasks,
	};
}
