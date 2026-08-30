import type { DesktopMcpTask } from "@preload/api";
import { subagentErrorPresentation, subagentObjective, subagentUsageLabel } from "@shared/lib/subagent-presentation";
import {
	activeSessionAtom,
	type BackgroundTask,
	backgroundTasksBySessionAtom,
	getBackgroundTasksForSession,
	getMcpTasksForSession,
	getSubagentsForSession,
	isSubagentActive,
	isWorkflowTask,
	mcpTasksBySessionAtom,
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
				icon: "icon-[solar--refresh-linear] animate-spin",
				label: t("activityPanel.backgroundTasks.statusRunning"),
				className: "text-emerald-400",
			};
		case "completed":
			return {
				icon: "icon-[solar--check-circle-linear]",
				label: t("activityPanel.backgroundTasks.statusCompleted"),
				className: "text-emerald-400",
			};
		case "failed":
			return {
				icon: "icon-[solar--danger-circle-linear]",
				label: t("activityPanel.backgroundTasks.statusFailed"),
				className: "text-destructive",
			};
		case "killed":
			return {
				icon: "icon-[solar--stop-circle-linear]",
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
				icon: "icon-[solar--clock-circle-linear]",
				label: t("activityPanel.backgroundTasks.subagentStatusPending"),
				className: "text-muted-foreground",
			};
		case "running":
			return {
				icon: "icon-[solar--refresh-linear] animate-spin",
				label: t("activityPanel.backgroundTasks.statusRunning"),
				className: "text-emerald-400",
			};
		case "completed":
			return {
				icon: "icon-[solar--check-circle-linear]",
				label: t("activityPanel.backgroundTasks.statusCompleted"),
				className: "text-emerald-400",
			};
		case "failed":
			return {
				icon: "icon-[solar--danger-circle-linear]",
				label: t("activityPanel.backgroundTasks.statusFailed"),
				className: "text-destructive",
			};
		case "interrupted":
			return {
				icon: "icon-[solar--stop-circle-linear]",
				label: t("activityPanel.backgroundTasks.subagentStatusInterrupted"),
				className: "text-muted-foreground",
			};
	}
}

function mcpTaskStatusMeta(
	status: DesktopMcpTask["status"],
	t: TFunction<"chat">,
): { icon: string; label: string; className: string } {
	switch (status) {
		case "working":
			return {
				icon: "icon-[solar--refresh-linear] animate-spin",
				label: t("activityPanel.mcpTasks.statusWorking"),
				className: "text-emerald-400",
			};
		case "input_required":
			return {
				icon: "icon-[solar--question-circle-linear]",
				label: t("activityPanel.mcpTasks.statusInputRequired"),
				className: "text-amber-400",
			};
		case "completed":
			return {
				icon: "icon-[solar--check-circle-linear]",
				label: t("activityPanel.backgroundTasks.statusCompleted"),
				className: "text-emerald-400",
			};
		case "failed":
			return {
				icon: "icon-[solar--danger-circle-linear]",
				label: t("activityPanel.backgroundTasks.statusFailed"),
				className: "text-destructive",
			};
		case "cancelled":
			return {
				icon: "icon-[solar--stop-circle-linear]",
				label: t("activityPanel.mcpTasks.statusCancelled"),
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
	const error = subagentErrorPresentation(agent.errorMessage, t);
	return {
		kind: "subagent",
		id: agent.id,
		agentType: agent.agentType,
		taskName: agent.taskName,
		path: agent.path,
		status: agent.status,
		taskPreview: subagentObjective(agent.task),
		finalText: agent.finalText,
		errorLabel: error?.label,
		errorDetail: error?.detail,
		progressLabel:
			agent.todoProgress && agent.todoProgress.total > 0
				? `${agent.todoProgress.done}/${agent.todoProgress.total}`
				: undefined,
		usageLabel: subagentUsageLabel(agent.usage, t),
		statusIcon: meta.icon,
		statusLabel: meta.label,
		statusClassName: meta.className,
		durationLabel: formatDuration(agent.startedAt, agent.endedAt, now, t),
	};
}

function toMcpTaskItem(task: DesktopMcpTask, now: number, t: TFunction<"chat">): BackgroundWorkViewItem {
	const meta = mcpTaskStatusMeta(task.status, t);
	return {
		kind: "mcp",
		id: task.id,
		serverName: task.serverName,
		toolName: task.toolName,
		status: task.status,
		statusMessage: task.statusMessage,
		statusIcon: meta.icon,
		statusLabel: meta.label,
		statusClassName: meta.className,
		durationLabel: formatDuration(Date.parse(task.createdAt), terminalTimestamp(task), now, t),
	};
}

function terminalTimestamp(task: DesktopMcpTask): number | undefined {
	return task.status === "completed" || task.status === "failed" || task.status === "cancelled"
		? Date.parse(task.lastUpdatedAt)
		: undefined;
}

export interface BackgroundTasksTabPanelModel {
	items: BackgroundWorkViewItem[];
	emptyLabel: string;
	clearFinishedLabel: string | null;
	onClearFinished: () => void;
	stopLabel: string;
	onStop: (id: string, kind: "bash" | "subagent" | "mcp") => void;
}

export function useBackgroundTasksTabPanelModel(): BackgroundTasksTabPanelModel {
	const { t } = useTranslation("chat");
	const tasksMap = useAtomValue(backgroundTasksBySessionAtom);
	const subagentsMap = useAtomValue(subagentsBySessionAtom);
	const mcpTasksMap = useAtomValue(mcpTasksBySessionAtom);
	const activeSession = useAtomValue(activeSessionAtom);
	const sessionId = activeSession?.runtimeId ?? null;

	const bashTasks = useMemo(() => getBackgroundTasksForSession(tasksMap, sessionId), [tasksMap, sessionId]);
	// Workflows have their own tab; this panel keeps bash + non-workflow subagents.
	const subagents = useMemo(
		() => getSubagentsForSession(subagentsMap, sessionId).filter((a) => !isWorkflowTask(a)),
		[subagentsMap, sessionId],
	);
	const mcpTasks = useMemo(() => getMcpTasksForSession(mcpTasksMap, sessionId), [mcpTasksMap, sessionId]);

	const hasRunning =
		bashTasks.some((task) => task.status === "running") ||
		subagents.some((a) => isSubagentActive(a.status)) ||
		mcpTasks.some((task) => task.status === "working" || task.status === "input_required");
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		if (!hasRunning) return;
		const id = window.setInterval(() => setNow(Date.now()), 1000);
		return () => window.clearInterval(id);
	}, [hasRunning]);

	const finishedBashCount = bashTasks.filter((task) => task.status !== "running").length;
	const finishedSubagentCount = subagents.filter((a) => !isSubagentActive(a.status)).length;
	const finishedCount = finishedBashCount + finishedSubagentCount;
	const finishedMcpCount = mcpTasks.filter(
		(task) => task.status === "completed" || task.status === "failed" || task.status === "cancelled",
	).length;
	const allFinishedCount = finishedCount + finishedMcpCount;

	const handleClearFinished = useCallback(() => {
		if (!sessionId) return;
		// Host clears both bash finished tasks and terminal subagents, then emits
		// Background-task + Subagent extension observations (or empty snapshots).
		void window.vetta.session.clearFinishedBackgroundTasks(sessionId);
		void window.vetta.session.clearFinishedMcpTasks(sessionId);
	}, [sessionId]);

	const handleStop = useCallback(
		(id: string, kind: "bash" | "subagent" | "mcp") => {
			if (!sessionId) return;
			if (kind === "bash") {
				void window.vetta.session.killBackgroundTask(sessionId, id);
			} else if (kind === "subagent") {
				void window.vetta.session.interruptSubagent?.(sessionId, id);
			} else {
				void window.vetta.session.cancelMcpTask(id);
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
		const mcpItems = mcpTasks.map((task) => ({
			sortAt: Date.parse(task.createdAt),
			item: toMcpTaskItem(task, now, t),
		}));
		return [...bashItems, ...subItems, ...mcpItems].sort((a, b) => b.sortAt - a.sortAt).map((row) => row.item);
	}, [bashTasks, subagents, mcpTasks, now, t]);

	return {
		items,
		emptyLabel: t("activityPanel.backgroundTasks.empty"),
		clearFinishedLabel:
			allFinishedCount > 0 ? t("activityPanel.backgroundTasks.clearFinished", { count: allFinishedCount }) : null,
		onClearFinished: handleClearFinished,
		stopLabel: t("activityPanel.backgroundTasks.stop"),
		onStop: handleStop,
	};
}
