import type { BatchProject, BatchTask } from "@shared/store/atoms";
import { batchQueuedTaskIdsAtom, confirmDialogAtom, openSessionFnRef } from "@shared/store/atoms";
import type { BatchQueueStatusViewProps, BatchQueueTaskItemView } from "@vetta/theme-ui/project";
import { useAtomValue, useSetAtom } from "jotai";
import { useMemo, useState } from "react";
import { useBatchTasks } from "../../batch-tasks/hooks/useBatchTasks";

function statusLabel(status: BatchTask["status"], hasSession: boolean): string {
	if (status === "pending") {
		return hasSession ? "等待中" : "未执行";
	}
	const labels: Record<Exclude<BatchTask["status"], "pending">, string> = {
		running: "运行中",
		completed: "已完成",
		failed: "失败",
		paused: "已暂停",
	};
	return labels[status];
}

function relativeTime(timestamp: number): string {
	const now = Date.now();
	const diff = now - timestamp;
	const minutes = Math.floor(diff / 60_000);
	if (minutes < 1) return "刚刚";
	if (minutes < 60) return `${minutes} 分钟前`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours} 小时前`;
	const days = Math.floor(hours / 24);
	if (days < 7) return `${days} 天前`;
	return `${Math.floor(days / 7)} 周前`;
}

function truncateError(error: string, maxLength: number = 60): string {
	if (error.length <= maxLength) return error;
	return `${error.slice(0, maxLength)}...`;
}

export function useBatchQueueStatusModel(project: BatchProject): BatchQueueStatusViewProps {
	const setConfirm = useSetAtom(confirmDialogAtom);
	const { runTask, retryTask, stopTask, batchStart, batchStop, batchReset } = useBatchTasks();
	const [searchQuery, setSearchQuery] = useState("");
	const normalizedQuery = searchQuery.trim().toLowerCase();
	const queuedTaskIds = useAtomValue(batchQueuedTaskIdsAtom);
	const tasks = project.tasks;

	const filteredTasks = useMemo(
		() =>
			(normalizedQuery ? tasks.filter((task) => task.name.toLowerCase().includes(normalizedQuery)) : tasks).map(
				(task): BatchQueueTaskItemView => {
					const isQueued = queuedTaskIds.has(task.id);
					const hasSession = Boolean(task.sessionId);
					return {
						id: task.id,
						name: task.name,
						status: task.status,
						statusLabel: isQueued ? "等待中" : statusLabel(task.status, hasSession),
						timeLabel: task.sessionId ? relativeTime(task.updatedAt) : null,
						error: task.error ?? null,
						truncatedError: task.error ? truncateError(task.error) : null,
						hasSessionPath: Boolean(task.sessionPath),
						isQueued,
					};
				},
			),
		[normalizedQuery, queuedTaskIds, tasks],
	);

	const total = tasks.length;
	const completed = tasks.filter((task) => task.status === "completed").length;
	const running = tasks.filter((task) => task.status === "running").length;
	const failed = tasks.filter((task) => task.status === "failed").length;
	const neverExecuted = tasks.filter((task) => task.status === "pending" && !task.sessionId).length;
	const nonCompleted = total - completed;
	const progress = total > 0 ? Math.round((completed / total) * 100) : 0;
	const hasQueued = tasks.some((task) => queuedTaskIds.has(task.id));
	const isBatchActive = running > 0 || hasQueued;

	const taskById = useMemo(() => new Map(tasks.map((task) => [task.id, task])), [tasks]);

	return {
		completed,
		failed,
		filteredTasks,
		isBatchActive,
		labels: {
			progressTitle: "执行进度",
			progressFraction: `${completed} / ${total} 个任务已完成`,
			running: "运行中",
			completed: "已完成",
			failed: "失败",
			neverExecuted: "未执行",
			stop: "停止",
			start: `开始 (${neverExecuted})`,
			reset: "重置",
			queueTitle: "任务队列",
			matchCount: `${filteredTasks.length}/${tasks.length} 匹配`,
			searchPlaceholder: "搜索任务标题…",
			clearSearch: "清除",
			noMatch: `没有匹配「${searchQuery}」的任务`,
			noTasks: "暂无任务",
			goToSession: "跳转到会话",
			cancelQueued: "取消等待",
			run: "执行",
			retry: "重试",
			rerun: "重新运行",
		},
		neverExecuted,
		progress,
		running,
		searchQuery,
		total,
		onBatchStart: () => {
			if (neverExecuted === 0) return;
			setConfirm({
				title: "确认开始执行",
				message: `将按并发数依次执行 ${neverExecuted} 个「未执行」任务，是否继续？`,
				confirmLabel: "开始",
				onConfirm: async () => {
					await batchStart(project.id);
				},
			});
		},
		onBatchStop: () => {
			if (nonCompleted === 0) return;
			setConfirm({
				title: "确认停止",
				message: [
					`将中断所有运行中的任务（${running} 个），并清空除「已完成」之外的所有任务（${nonCompleted} 个）的会话、产物和状态，重置为「未执行」。`,
					"",
					"保留：已完成任务的会话、产物和状态。",
					"已完成任务保留，此操作不可撤回。",
				].join("\n"),
				confirmLabel: "停止",
				cancelLabel: "取消",
				variant: "danger",
				onConfirm: async () => {
					await batchStop(project.id);
				},
			});
		},
		onBatchReset: () => {
			setConfirm({
				title: "确认重置",
				message: `将删除所有任务的会话和文件（包含已完成），然后重新执行全部 ${total} 个任务。此操作不可撤回，是否继续？`,
				confirmLabel: "重置",
				cancelLabel: "取消",
				variant: "danger",
				onConfirm: async () => {
					await batchReset(project.id);
				},
			});
		},
		onCancelQueued: (taskId) => {
			void stopTask(project.id, taskId);
		},
		onClearSearch: () => setSearchQuery(""),
		onGoToSession: (taskId) => {
			const task = taskById.get(taskId);
			if (task?.sessionPath && openSessionFnRef.current) {
				void openSessionFnRef.current(task.cwd, task.sessionPath, task.executionMode);
			}
		},
		onRetry: (taskId) => {
			const task = taskById.get(taskId);
			if (!task) return;
			const isCompleted = task.status === "completed";
			setConfirm({
				title: isCompleted ? `确认重新运行任务「${task.name}」` : `确认重试任务「${task.name}」`,
				message: isCompleted
					? "将删除该任务现有的会话和产物，并重新执行。此操作不可撤回，是否继续？"
					: "将删除该任务的会话和文件，然后重新执行。此操作不可撤回，是否继续？",
				confirmLabel: isCompleted ? "重新运行" : "重试",
				cancelLabel: "取消",
				variant: isCompleted ? undefined : "danger",
				onConfirm: async () => {
					await retryTask(project.id, task.id);
				},
			});
		},
		onRun: (taskId) => {
			void runTask(project.id, taskId);
		},
		onSearchChange: setSearchQuery,
	};
}
