import type { DesktopActionApprovalRequest } from "@preload/api.js";
import { type BatchTask, type BatchTaskStatus, batchProjectsAtom } from "@shared/store/atoms";
import { useAtomValue } from "jotai";
import { useTranslation } from "react-i18next";
import { useActionApproval } from "../useActionApproval";
import type { BatchTasksApprovalFrameViewProps } from "./BatchTasksApprovalFrameView";

type ExecutionOperation = "delete-all" | "start" | "stop" | "reset" | "reset-failed";

interface ExecutionInput {
	operation: ExecutionOperation;
	projectId: string;
	taskIds?: string[];
}

function parseExecutionInput(input: DesktopActionApprovalRequest["input"]): ExecutionInput | null {
	if (typeof input !== "object" || input === null || Array.isArray(input)) return null;
	const record = input as Record<string, unknown>;
	const operations: ExecutionOperation[] = ["delete-all", "start", "stop", "reset", "reset-failed"];
	if (
		typeof record.operation !== "string" ||
		!operations.includes(record.operation as ExecutionOperation) ||
		typeof record.projectId !== "string"
	) {
		return null;
	}
	if (record.operation === "reset-failed") {
		if (!Array.isArray(record.taskIds) || !record.taskIds.every((id) => typeof id === "string")) return null;
		return { operation: "reset-failed", projectId: record.projectId, taskIds: record.taskIds };
	}
	return { operation: record.operation as ExecutionOperation, projectId: record.projectId };
}

function countStatuses(tasks: BatchTask[]): Record<BatchTaskStatus, number> {
	const counts: Record<BatchTaskStatus, number> = {
		pending: 0,
		running: 0,
		completed: 0,
		failed: 0,
		paused: 0,
	};
	for (const task of tasks) counts[task.status] += 1;
	return counts;
}

function getTaskStatusLabel(status: BatchTaskStatus, t: ReturnType<typeof useTranslation<"common">>["t"]): string {
	switch (status) {
		case "pending":
			return t("batchTasksApproval.status.pending");
		case "running":
			return t("batchTasksApproval.status.running");
		case "completed":
			return t("batchTasksApproval.status.completed");
		case "failed":
			return t("batchTasksApproval.status.failed");
		case "paused":
			return t("batchTasksApproval.status.paused");
	}
}

function getExecutionOperationDetail(
	operation: ExecutionOperation,
	t: ReturnType<typeof useTranslation<"common">>["t"],
): {
	label: string;
	title: string;
	summary: string;
	icon: string;
	description: string;
	warning?: string;
	destructive?: boolean;
} {
	switch (operation) {
		case "delete-all":
			return {
				label: t("batchTasksApproval.executionDeleteAllLabel"),
				title: t("batchTasksApproval.executionDeleteAllTitle"),
				summary: t("batchTasksApproval.executionDeleteAllSummary"),
				icon: "icon-[mdi--delete-sweep-outline]",
				description: t("batchTasksApproval.executionDeleteAllDescription"),
				warning: t("batchTasksApproval.executionDeleteAllWarning"),
				destructive: true,
			};
		case "start":
			return {
				label: t("batchTasksApproval.executionStartLabel"),
				title: t("batchTasksApproval.executionStartTitle"),
				summary: t("batchTasksApproval.executionStartSummary"),
				icon: "icon-[mdi--play-circle-outline]",
				description: t("batchTasksApproval.executionStartDescription"),
			};
		case "stop":
			return {
				label: t("batchTasksApproval.executionStopLabel"),
				title: t("batchTasksApproval.executionStopTitle"),
				summary: t("batchTasksApproval.executionStopSummary"),
				icon: "icon-[mdi--stop-circle-outline]",
				description: t("batchTasksApproval.executionStopDescription"),
				warning: t("batchTasksApproval.executionStopWarning"),
				destructive: true,
			};
		case "reset":
			return {
				label: t("batchTasksApproval.executionResetLabel"),
				title: t("batchTasksApproval.executionResetTitle"),
				summary: t("batchTasksApproval.executionResetSummary"),
				icon: "icon-[mdi--restart]",
				description: t("batchTasksApproval.executionResetDescription"),
				warning: t("batchTasksApproval.executionResetWarning"),
				destructive: true,
			};
		case "reset-failed":
			return {
				label: t("batchTasksApproval.executionResetFailedLabel"),
				title: t("batchTasksApproval.executionResetFailedTitle"),
				summary: t("batchTasksApproval.executionResetFailedSummary"),
				icon: "icon-[mdi--refresh-circle]",
				description: t("batchTasksApproval.executionResetFailedDescription"),
				warning: t("batchTasksApproval.executionResetFailedWarning"),
				destructive: true,
			};
	}
}

export interface ExecutionSelectedTaskView {
	readonly id: string;
	readonly name?: string;
	readonly sourcePath?: string;
	readonly statusLabel: string;
	readonly failed: boolean;
}

export interface BatchTasksExecutionApprovalModel {
	readonly approvalId: string;
	readonly frame: Omit<BatchTasksApprovalFrameViewProps, "children">;
	readonly hasInput: boolean;
	readonly rawInput: unknown;
	readonly projectName: string;
	readonly projectId: string;
	readonly totalTasksLabel: string;
	readonly totalTasksCaption: string;
	readonly statusCounts: ReadonlyArray<{
		readonly status: BatchTaskStatus;
		readonly count: number;
		readonly label: string;
	}>;
	readonly afterActionTitle: string;
	readonly description: string;
	readonly icon: string;
	readonly affectedCount: number;
	readonly estimatedImpactLabel: string;
	readonly showSelectedTasks: boolean;
	readonly selectedTasks: readonly ExecutionSelectedTaskView[];
	readonly selectedTasksTitle: string;
	readonly selectedTasksCountLabel: string;
	readonly notFoundLabel: string;
	readonly partialWarning: string | null;
	readonly warning: string | null;
}

export function useBatchTasksExecutionApprovalModel(): BatchTasksExecutionApprovalModel | null {
	const { t } = useTranslation("common");
	const approval = useActionApproval("batch-tasks.execution");
	const projects = useAtomValue(batchProjectsAtom);
	if (!approval) return null;

	const { request, responding, error, approve, reject } = approval;
	const input = parseExecutionInput(request.input);
	const project = input ? projects.find((item) => item.id === input.projectId) : undefined;
	const detail = input ? getExecutionOperationDetail(input.operation, t) : undefined;
	const counts = countStatuses(project?.tasks ?? []);
	const selectedTasks =
		input?.operation === "reset-failed"
			? (input.taskIds ?? []).map((id) => project?.tasks.find((task) => task.id === id) ?? { id })
			: [];
	const affectedCount = input
		? {
				"delete-all": (project?.tasks.length ?? 0) - counts.running,
				start: counts.pending + counts.paused,
				stop: counts.pending + counts.running + counts.failed + counts.paused,
				reset: project?.tasks.length ?? 0,
				"reset-failed": selectedTasks.filter((task) => "status" in task && task.status === "failed").length,
			}[input.operation]
		: 0;

	return {
		approvalId: request.approvalId,
		frame: {
			presentation: "dialog",
			title: detail?.title ?? t("batchTasksApproval.executionFallbackTitle"),
			summary: detail?.summary ?? request.summary,
			icon: detail?.icon ?? "icon-[mdi--cog-play-outline]",
			badge: detail?.label,
			destructive: detail?.destructive,
			labels: {
				reject: t("actionApproval.reject"),
				confirm: t("batchTasksApproval.confirmAction", {
					action: detail?.label ?? t("batchTasksApproval.fallbackAction"),
				}),
				responding: t("actionApproval.processing"),
				permission: t("actionApproval.permission", { permission: request.permission }),
			},
			responding,
			countdown: approval.countdown.formatted,
			error,
			onReject: reject,
			onApprove: () => approve(),
		},
		hasInput: Boolean(input && detail),
		rawInput: request.input,
		projectName: project?.name ?? t("batchTasksApproval.projectNotFoundInCurrentList"),
		projectId: input?.projectId ?? "",
		totalTasksLabel: String(project?.tasks.length ?? t("batchTasksApproval.unknownShort")),
		totalTasksCaption: t("batchTasksApproval.totalTasks"),
		statusCounts: (["pending", "running", "completed", "failed", "paused"] as BatchTaskStatus[]).map((status) => ({
			status,
			count: counts[status],
			label: getTaskStatusLabel(status, t),
		})),
		afterActionTitle: t("batchTasksApproval.afterActionTitle"),
		description: detail?.description ?? "",
		icon: detail?.icon ?? "icon-[mdi--cog-play-outline]",
		affectedCount,
		estimatedImpactLabel: t("batchTasksApproval.estimatedImpact"),
		showSelectedTasks: input?.operation === "reset-failed",
		selectedTasks: selectedTasks.map((task) => ({
			id: task.id,
			name: "name" in task ? task.name : undefined,
			sourcePath: "sourcePath" in task ? task.sourcePath : undefined,
			statusLabel: "status" in task ? getTaskStatusLabel(task.status, t) : t("batchTasksApproval.notFound"),
			failed: "status" in task && task.status === "failed",
		})),
		selectedTasksTitle: t("batchTasksApproval.selectedTasks"),
		selectedTasksCountLabel: t("batchTasksApproval.count", { count: selectedTasks.length }),
		notFoundLabel: t("batchTasksApproval.notFound"),
		partialWarning:
			input?.operation === "reset-failed" && affectedCount !== selectedTasks.length
				? t("batchTasksApproval.resetFailedPartialWarning")
				: null,
		warning: detail?.warning ?? null,
	};
}
