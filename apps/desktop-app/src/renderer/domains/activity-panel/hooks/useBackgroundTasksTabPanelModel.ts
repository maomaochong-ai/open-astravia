import {
	activeSessionAtom,
	type BackgroundTask,
	backgroundTasksBySessionAtom,
	getBackgroundTasksForSession,
	getSubagentsForSession,
	isSubagentActive,
	isWorkflowTask,
	type SubagentTask,
	subagentsBySessionAtom,
} from "@shared/store/atoms";
import type { BackgroundWorkViewItem } from "@vetta/theme-ui/activity";
import type { TFunction } from "i18next";
import { useAtomValue } from "jotai";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

function bashStatusMeta(
	status: BackgroundTask["status"],
	t: TFunction<"chat">,
): { icon: string; label: string; className: string } {
	switch (status) {
		case "running":
			return {
				icon: "icon-[mdi--loading] animate-spin",
				label: t("activityPanel.backgroundTasks.statusRunning"),
				className: "text-blue-500",
			};
		case "completed":
			return {
				icon: "icon-[mdi--check-circle-outline]",
				label: t("activityPanel.backgroundTasks.statusCompleted"),
				className: "text-emerald-600",
			};
		case "failed":
			return {
				icon: "icon-[mdi--close-circle-outline]",
				label: t("activityPanel.backgroundTasks.statusFailed"),
				className: "text-destructive",
			};
		case "killed":
			return {
				icon: "icon-[mdi--stop-circle-outline]",
				label: t("activityPanel.backgroundTasks.statusKilled"),
				className: "text-muted-foreground",
			};
	}
}

function subagentStatusMeta(
	status: SubagentTask["status"],
	t: TFunction<"chat">,
): { icon: string; label: string; className: string } {
	switch (status) {
		case "queued":
		case "pending":
			return {
				icon: "icon-[mdi--clock-outline]",
				label: t("activityPanel.backgroundTasks.subagentStatusPending"),
				className: "text-muted-foreground",
			};
		case "running":
			return {
				icon: "icon-[mdi--loading] animate-spin",
				label: t("activityPanel.backgroundTasks.statusRunning"),
				className: "text-blue-500",
			};
		case "completed":
			return {
				icon: "icon-[mdi--check-circle-outline]",
				label: t("activityPanel.backgroundTasks.statusCompleted"),
				className: "text-emerald-600",
			};
		case "failed":
			return {
				icon: "icon-[mdi--close-circle-outline]",
				label: t("activityPanel.backgroundTasks.statusFailed"),
				className: "text-destructive",
			};
		case "interrupted":
			return {
				icon: "icon-[mdi--stop-circle-outline]",
				label: t("activityPanel.backgroundTasks.subagentStatusInterrupted"),
				className: "text-muted-foreground",
			};
	}
}

function formatDuration(startedAt: number, endedAt: number | undefined, now: number, t: TFunction<"chat">): string {
	const ms = Math.max(0, (endedAt ?? now) - startedAt);
	const sec = Math.floor(ms / 1000);
	if (sec < 60) return t("activityPanel.backgroundTasks.durationSec", { sec });
	const min = Math.floor(sec / 60);
	if (min < 60) return t("activityPanel.backgroundTasks.durationMin", { min, sec: sec % 60 });
	const hr = Math.floor(min / 60);
	return t("activityPanel.backgroundTasks.durationHour", { hr, min: min % 60 });
}

function toBashItem(task: BackgroundTask, now: number, t: TFunction<"chat">): BackgroundWorkViewItem {
	const meta = bashStatusMeta(task.status, t);
	return {
		kind: "bash",
		id: task.id,
		command: task.command,
		status: task.status,
		tail: task.tail,
		exitCode: task.exitCode,
		statusIcon: meta.icon,
		statusLabel: meta.label,
		statusClassName: meta.className,
		durationLabel: formatDuration(task.startedAt, task.endedAt, now, t),
	};
}

function toSubagentItem(agent: SubagentTask, now: number, t: TFunction<"chat">): BackgroundWorkViewItem {
	const meta = subagentStatusMeta(agent.status, t);
	return {
		kind: "subagent",
		id: agent.id,
		agentType: agent.agentType,
		taskName: agent.taskName,
		path: agent.path,
		status: agent.status,
		taskPreview: agent.task,
		finalText: agent.finalText,
		errorMessage: agent.errorMessage,
		statusIcon: meta.icon,
		statusLabel: meta.label,
		statusClassName: meta.className,
		durationLabel: formatDuration(agent.startedAt, agent.endedAt, now, t),
	};
}

export interface BackgroundTasksTabPanelModel {
	items: BackgroundWorkViewItem[];
	emptyLabel: string;
	clearFinishedLabel: string | null;
	onClearFinished: () => void;
	stopLabel: string;
	onStop: (id: string, kind: "bash" | "subagent") => void;
}

export function useBackgroundTasksTabPanelModel(): BackgroundTasksTabPanelModel {
	const { t } = useTranslation("chat");
	const tasksMap = useAtomValue(backgroundTasksBySessionAtom);
	const subagentsMap = useAtomValue(subagentsBySessionAtom);
	const activeSession = useAtomValue(activeSessionAtom);
	const sessionId = activeSession?.runtimeId ?? null;

	const bashTasks = useMemo(() => getBackgroundTasksForSession(tasksMap, sessionId), [tasksMap, sessionId]);
	// Workflows have their own tab; this panel keeps bash + non-workflow subagents.
	const subagents = useMemo(
		() => getSubagentsForSession(subagentsMap, sessionId).filter((a) => !isWorkflowTask(a)),
		[subagentsMap, sessionId],
	);

	const hasRunning =
		bashTasks.some((task) => task.status === "running") || subagents.some((a) => isSubagentActive(a.status));
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		if (!hasRunning) return;
		const id = window.setInterval(() => setNow(Date.now()), 1000);
		return () => window.clearInterval(id);
	}, [hasRunning]);

	const finishedBashCount = bashTasks.filter((task) => task.status !== "running").length;
	const finishedSubagentCount = subagents.filter((a) => !isSubagentActive(a.status)).length;
	const finishedCount = finishedBashCount + finishedSubagentCount;

	const handleClearFinished = useCallback(() => {
		if (!sessionId) return;
		// Host clears both bash finished tasks and terminal subagents, then emits
		// background_tasks_update + subagents_update (or empty snapshots).
		void window.vetta.session.clearFinishedBackgroundTasks(sessionId);
	}, [sessionId]);

	const handleStop = useCallback(
		(id: string, kind: "bash" | "subagent") => {
			if (!sessionId) return;
			if (kind === "bash") {
				void window.vetta.session.killBackgroundTask(sessionId, id);
			} else {
				void window.vetta.session.interruptSubagent?.(sessionId, id);
			}
		},
		[sessionId],
	);

	const items = useMemo(() => {
		const bashItems = bashTasks.map((task) => ({
			sortAt: task.startedAt,
			item: toBashItem(task, now, t),
		}));
		const subItems = subagents.map((agent) => ({
			sortAt: agent.startedAt,
			item: toSubagentItem(agent, now, t),
		}));
		return [...bashItems, ...subItems].sort((a, b) => b.sortAt - a.sortAt).map((row) => row.item);
	}, [bashTasks, subagents, now, t]);

	return {
		items,
		emptyLabel: t("activityPanel.backgroundTasks.empty"),
		clearFinishedLabel:
			finishedCount > 0 ? t("activityPanel.backgroundTasks.clearFinished", { count: finishedCount }) : null,
		onClearFinished: handleClearFinished,
		stopLabel: t("activityPanel.backgroundTasks.stop"),
		onStop: handleStop,
	};
}
