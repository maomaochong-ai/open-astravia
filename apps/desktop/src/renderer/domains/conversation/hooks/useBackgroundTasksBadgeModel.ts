import type { ActivityTabKey } from "@shared/lib/project-profile";
import {
	activeSessionAtom,
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

export function useBackgroundTasksBadgeModel(): BackgroundTasksBadgeModel {
	const { t } = useTranslation("chat");
	const activeSession = useAtomValue(activeSessionAtom);
	const tasksMap = useAtomValue(backgroundTasksBySessionAtom);
	const subagentsMap = useAtomValue(subagentsBySessionAtom);
	const setPanelOpen = useSetAtom(activityPanelOpenAtom);
	const setTabByProject = useSetAtom(activityPanelTabByProjectAtom);

	const tasks = useMemo(
		() => getBackgroundTasksForSession(tasksMap, activeSession?.runtimeId ?? null),
		[tasksMap, activeSession?.runtimeId],
	);
	// Workflows surface via footer items + workflow tab, not this badge.
	const subagents = useMemo(
		() => getSubagentsForSession(subagentsMap, activeSession?.runtimeId ?? null).filter((a) => !isWorkflowTask(a)),
		[subagentsMap, activeSession?.runtimeId],
	);
	const running = useMemo(() => {
		const bash = tasks.filter((task) => task.status === "running").length;
		const sub = subagents.filter((a) => isSubagentActive(a.status)).length;
		return bash + sub;
	}, [tasks, subagents]);

	const onClick = useCallback(() => {
		const cwd = activeSession?.cwd;
		if (cwd) {
			setTabByProject((prev) => {
				const map = new Map(prev);
				map.set(cwd, "background-tasks" as ActivityTabKey);
				return map;
			});
		}
		setPanelOpen(true);
	}, [activeSession?.cwd, setPanelOpen, setTabByProject]);

	return {
		runningCount: running === 0 ? null : running,
		title: t("backgroundTasksBadge.runningTasksTooltip", { count: running }),
		onClick,
	};
}
