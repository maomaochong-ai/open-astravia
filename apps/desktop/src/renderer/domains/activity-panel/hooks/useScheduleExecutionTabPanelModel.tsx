import { useScheduledTasks } from "@domains/scheduler/hooks/useScheduledTasks";
import { Button } from "@shared/components/ui/button";
import {
	openSessionFnRef,
	type ScheduledTask,
	type TaskExecutionRecord,
} from "@shared/store/atoms";
import type {
	ScheduleExecutionTabPanelViewLabels,
	ScheduleRecordItem,
	ScheduleSummaryCardItem,
	ScheduleTaskControlItem,
} from "@vetta/theme-ui/activity";
import type { TFunction } from "i18next";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

function isSameDay(timestamp: number, base: Date): boolean {
	const date = new Date(timestamp);
	return (
		date.getFullYear() === base.getFullYear() &&
		date.getMonth() === base.getMonth() &&
		date.getDate() === base.getDate()
	);
}

function formatTime(timestamp: number): string {
	return new Date(timestamp).toLocaleString("zh-CN", {
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
	});
}

function formatDuration(durationMs?: number): string | null {
	if (!durationMs || durationMs <= 0) return null;
	if (durationMs < 1000) return `${durationMs}ms`;
	if (durationMs < 60_000) return `${(durationMs / 1000).toFixed(1)}s`;
	const minutes = Math.floor(durationMs / 60_000);
	const seconds = Math.round((durationMs % 60_000) / 1000);
	return `${minutes}m ${seconds}s`;
}

function statusLabel(status: TaskExecutionRecord["status"], t: TFunction<"chat">): string {
	switch (status) {
		case "running":
			return t("activityPanel.schedule.statusRunning");
		case "success":
			return t("activityPanel.schedule.statusSuccess");
		case "failed":
			return t("activityPanel.schedule.statusFailed");
		case "aborted":
			return t("activityPanel.schedule.statusAborted");
	}
}

function statusClass(status: TaskExecutionRecord["status"]): string {
	switch (status) {
		case "running":
			return "bg-sky-500/10 text-sky-500";
		case "success":
			return "bg-emerald-500/10 text-emerald-500";
		case "failed":
			return "bg-red-500/10 text-red-500";
		case "aborted":
			return "bg-amber-500/10 text-amber-500";
	}
}

export interface ScheduleExecutionTabPanelModel {
	empty: boolean;
	labels: ScheduleExecutionTabPanelViewLabels;
	summaries: ScheduleSummaryCardItem[];
	refreshButton: ReactNode;
	tasks: ScheduleTaskControlItem[];
	records: ScheduleRecordItem[];
}

export function useScheduleExecutionTabPanelModel(cwd: string): ScheduleExecutionTabPanelModel {
	const { t } = useTranslation("chat");
	const { tasks, runNow, toggleTask, refreshTasks } = useScheduledTasks();
	const [recordsByTaskId, setRecordsByTaskId] = useState<Record<string, TaskExecutionRecord[]>>({});

	const projectTasks = useMemo(() => tasks.filter((task) => task.cwd === cwd), [tasks, cwd]);

	const loadRecords = useCallback(async (targetTasks: ScheduledTask[]) => {
		const entries = await Promise.all(
			targetTasks.map(async (task) => {
				const records = await window.vetta.scheduler.getRecords(task.id);
				return [task.id, records] as const;
			}),
		);
		setRecordsByTaskId(Object.fromEntries(entries));
	}, []);

	const refreshAll = useCallback(async () => {
		await refreshTasks();
	}, [refreshTasks]);

	useEffect(() => {
		void refreshAll();
	}, [refreshAll]);

	useEffect(() => {
		void loadRecords(projectTasks);
	}, [projectTasks, loadRecords]);

	useEffect(() => {
		const unsubscribe = window.vetta.scheduler.onTaskEvent(async () => {
			await refreshTasks();
		});
		return unsubscribe;
	}, [refreshTasks]);

	const recordsRaw = useMemo(() => {
		const taskNameById = new Map(projectTasks.map((task) => [task.id, task.name] as const));
		return Object.entries(recordsByTaskId)
			.flatMap(([taskId, taskRecords]) =>
				taskRecords.map((record) => ({
					...record,
					taskName: taskNameById.get(taskId) ?? t("activityPanel.schedule.unnamedTask"),
				})),
			)
			.sort((a, b) => b.startedAt - a.startedAt)
			.slice(0, 80);
	}, [projectTasks, recordsByTaskId, t]);

	const today = new Date();
	const enabledCount = projectTasks.filter((task) => task.enabled).length;
	const todayCount = recordsRaw.filter((record) => isSameDay(record.startedAt, today)).length;

	const handleOpenSession = useCallback((record: TaskExecutionRecord) => {
		if (!record.sessionPath || !record.cwd || !openSessionFnRef.current) return;
		void openSessionFnRef.current(record.cwd, record.sessionPath, record.executionMode);
	}, []);

	const labels: ScheduleExecutionTabPanelViewLabels = {
		noTasks: t("activityPanel.schedule.noTasks"),
		overview: t("activityPanel.schedule.overview"),
		taskControl: t("activityPanel.schedule.taskControl"),
		executionRecords: t("activityPanel.schedule.executionRecords"),
		noRecords: t("activityPanel.schedule.noRecords"),
	};

	const summaries: ScheduleSummaryCardItem[] = [
		{
			label: t("activityPanel.schedule.totalTasks"),
			value: projectTasks.length,
			icon: "icon-[mdi--clock-outline]",
		},
		{
			label: t("activityPanel.schedule.enabled"),
			value: enabledCount,
			icon: "icon-[mdi--play-circle-outline]",
		},
		{
			label: t("activityPanel.schedule.todayExecutions"),
			value: todayCount,
			icon: "icon-[mdi--calendar-clock]",
		},
	];

	const refreshButton = (
		<Button
			size="sm"
			variant="outline"
			className="h-7 rounded-lg border-border/50 px-2 text-[11px]"
			onClick={() => void refreshAll()}
		>
			<span className="icon-[mdi--refresh] mr-1 h-3.5 w-3.5" />
			{t("activityPanel.schedule.refresh")}
		</Button>
	);

	const taskItems: ScheduleTaskControlItem[] = projectTasks.map((task) => ({
		id: task.id,
		name: task.name,
		enabledBadge: task.enabled
			? t("activityPanel.schedule.enabledBadge")
			: t("activityPanel.schedule.pausedBadge"),
		enabledBadgeClassName: task.enabled
			? "bg-emerald-500/10 text-emerald-500"
			: "bg-accent text-muted-foreground",
		actions: (
			<>
				<Button
					size="sm"
					variant="outline"
					className="h-7 rounded-md border-border/40 px-2 text-[11px]"
					onClick={() => void runNow(task.id)}
				>
					<span className="icon-[mdi--play-circle-outline] mr-1 h-3.5 w-3.5" />
					{t("activityPanel.schedule.run")}
				</Button>
				<Button
					size="sm"
					variant="outline"
					className="h-7 rounded-md border-border/40 px-2 text-[11px]"
					onClick={() => void toggleTask(task.id)}
				>
					<span
						className={`${task.enabled ? "icon-[mdi--pause-circle-outline]" : "icon-[mdi--play-circle-outline]"} mr-1 h-3.5 w-3.5`}
					/>
					{task.enabled ? t("activityPanel.schedule.pause") : t("activityPanel.schedule.enable")}
				</Button>
			</>
		),
	}));

	const records: ScheduleRecordItem[] = recordsRaw.map((record) => {
		const duration = formatDuration(record.durationMs);
		const clickable = Boolean(record.sessionPath && record.cwd && openSessionFnRef.current);
		return {
			id: record.id,
			taskName: record.taskName,
			timeLabel: formatTime(record.startedAt),
			statusLabel: statusLabel(record.status, t),
			statusClassName: statusClass(record.status),
			durationLabel: duration,
			error: record.error ?? null,
			preview: record.responsePreview ?? null,
			clickable,
			onClick: () => handleOpenSession(record),
		};
	});

	return {
		empty: projectTasks.length === 0,
		labels,
		summaries,
		refreshButton,
		tasks: taskItems,
		records,
	};
}
