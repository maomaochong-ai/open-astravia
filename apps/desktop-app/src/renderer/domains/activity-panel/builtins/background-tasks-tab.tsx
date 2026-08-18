import {
	activeSessionAtom,
	backgroundTasksBySessionAtom,
	getBackgroundTasksForSession,
	getSubagentsForSession,
	isSubagentActive,
	isWorkflowTask,
	subagentsBySessionAtom,
} from "@shared/store/atoms";
import { useAtomValue } from "jotai";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { BackgroundTasksTabPanel } from "../components/BackgroundTasksTabPanel";
import type { ActivityTabDefinition } from "../registry/types";

function BackgroundTasksActivityTab(): JSX.Element {
	return <BackgroundTasksTabPanel />;
}

export const backgroundTasksTabDefinition: ActivityTabDefinition = {
	id: "background-tasks",
	order: 30,
	removable: true,
	source: "builtin",
	useMeta: () => {
		const { t } = useTranslation("chat");
		const activeSession = useAtomValue(activeSessionAtom);
		const backgroundTasksMap = useAtomValue(backgroundTasksBySessionAtom);
		const subagentsMap = useAtomValue(subagentsBySessionAtom);
		const backgroundTasks = useMemo(
			() => getBackgroundTasksForSession(backgroundTasksMap, activeSession?.runtimeId ?? null),
			[backgroundTasksMap, activeSession?.runtimeId],
		);
		const subagents = useMemo(() => {
			const all = getSubagentsForSession(subagentsMap, activeSession?.runtimeId ?? null);
			return all.filter((a) => !isWorkflowTask(a));
		}, [subagentsMap, activeSession?.runtimeId]);
		if (backgroundTasks.length === 0 && subagents.length === 0) return null;
		const runningBash = backgroundTasks.filter((task) => task.status === "running").length;
		const runningSub = subagents.filter((a) => isSubagentActive(a.status)).length;
		const running = runningBash + runningSub;
		return {
			label: t("activityPanel.tabs.backgroundTasks"),
			icon: "icon-[mdi--console-line]",
			badge: running || undefined,
		};
	},
	component: BackgroundTasksActivityTab,
};
