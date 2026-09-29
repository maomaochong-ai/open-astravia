import type { ActivityTabKey } from "@shared/lib/project-profile";
import {
	activityPanelOpenAtom,
	activityPanelTabByProjectAtom,
	backgroundTasksBySessionAtom,
	getBackgroundTasksForSession,
	getSubagentsForSession,
	isSubagentActive,
	isWorkflowTask,
	subagentsBySessionAtom,
} from "@shared/store/atoms";
import { useAtomValue, useSetAtom } from "jotai";
import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";

export interface BackgroundTasksBadgeModel {
	/** Null when no running work (host renders null). */
	runningCount: number | null;
	title: string;
	onClick: () => void;
}

export function useBackgroundTasksBadgeModel(
	runtimeIds: readonly string[],
	activityWorkspaceId: string,
): BackgroundTasksBadgeModel {
	const { t } = useTranslation("chat");
	const tasksMap = useAtomValue(backgroundTasksBySessionAtom);
	const subagentsMap = useAtomValue(subagentsBySessionAtom);
	const setPanelOpen = useSetAtom(activityPanelOpenAtom);
	const setTabByProject = useSetAtom(activityPanelTabByProjectAtom);

	const tasks = useMemo(
		() => runtimeIds.flatMap((runtimeId) => getBackgroundTasksForSession(tasksMap, runtimeId)),
		[tasksMap, runtimeIds],
	);
	// Workflows surface via footer items + workflow tab, not this badge.
	const subagents = useMemo(
		() =>
			runtimeIds.flatMap((runtimeId) =>
				getSubagentsForSession(subagentsMap, runtimeId).filter((agent) => !isWorkflowTask(agent)),
			),
		[subagentsMap, runtimeIds],
	);
	const running = useMemo(() => {
		const bash = tasks.filter((task) => task.status === "running").length;
		const sub = subagents.filter((a) => isSubagentActive(a.status)).length;
		return bash + sub;
	}, [tasks, subagents]);

	const onClick = useCallback(() => {
		if (activityWorkspaceId) {
			setTabByProject((prev) => {
				const map = new Map(prev);
				map.set(activityWorkspaceId, "background-tasks" as ActivityTabKey);
				return map;
			});
		}
		setPanelOpen(true);
	}, [activityWorkspaceId, setPanelOpen, setTabByProject]);

	return {
		runningCount: running === 0 ? null : running,
		title: t("backgroundTasksBadge.runningTasksTooltip", { count: running }),
		onClick,
	};
}
