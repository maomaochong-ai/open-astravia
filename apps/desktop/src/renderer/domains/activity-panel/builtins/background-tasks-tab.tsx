import {
	backgroundTasksBySessionAtom,
	getBackgroundTasksForSession,
	getMcpTasksForSession,
	getSubagentsForSession,
	isSubagentActive,
	isWorkflowTask,
	mcpTasksBySessionAtom,
	subagentsBySessionAtom,
} from "@shared/store/atoms";
import { useAtomValue } from "jotai";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { BackgroundTasksTabPanel } from "../components/BackgroundTasksTabPanel";
import { useActivityRuntimeIds } from "../registry/context";
import type { ActivityTabDefinition } from "../registry/types";
import { collectRuntimeItems } from "../services/runtime-scope";

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
		const runtimeIds = useActivityRuntimeIds();
		const backgroundTasksMap = useAtomValue(backgroundTasksBySessionAtom);
		const subagentsMap = useAtomValue(subagentsBySessionAtom);
		const mcpTasksMap = useAtomValue(mcpTasksBySessionAtom);
		const backgroundTasks = useMemo(
			() =>
				collectRuntimeItems(runtimeIds, (runtimeId) =>
					getBackgroundTasksForSession(backgroundTasksMap, runtimeId),
				),
			[backgroundTasksMap, runtimeIds],
		);
		const subagents = useMemo(
			() =>
				collectRuntimeItems(runtimeIds, (runtimeId) =>
					getSubagentsForSession(subagentsMap, runtimeId).filter((a) => !isWorkflowTask(a)),
				),
			[subagentsMap, runtimeIds],
		);
		const mcpTasks = useMemo(
			() => collectRuntimeItems(runtimeIds, (runtimeId) => getMcpTasksForSession(mcpTasksMap, runtimeId)),
			[mcpTasksMap, runtimeIds],
		);
		if (backgroundTasks.length === 0 && subagents.length === 0 && mcpTasks.length === 0) return null;
		const runningBash = backgroundTasks.filter((task) => task.status === "running").length;
		const runningSub = subagents.filter((a) => isSubagentActive(a.status)).length;
		const runningMcp = mcpTasks.filter(
			(task) => task.status === "working" || task.status === "input_required",
		).length;
		const running = runningBash + runningSub + runningMcp;
		return {
			label: t("activityPanel.tabs.backgroundTasks"),
			icon: "icon-[mdi--console-line]",
			badge: running || undefined,
		};
	},
	component: BackgroundTasksActivityTab,
};
