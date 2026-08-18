import type { DesktopActionApprovalRequest, DesktopActionJsonValue } from "@preload/api.js";
import { type BatchTaskStatus, batchProjectsAtom } from "@shared/store/atoms";
import { useAtomValue } from "jotai";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useActionApproval } from "../useActionApproval";
import type { BatchTasksApprovalFrameViewProps } from "./BatchTasksApprovalFrameView";

type TaskOperation = "run" | "retry" | "stop" | "delete" | "resume" | "resume-with-text" | "delete-session";

interface TaskInput {
	operation: TaskOperation;
	projectId: string;
	taskId: string;
	text?: string;
}

function parseTaskInput(input: DesktopActionApprovalRequest["input"]): TaskInput | null {
	if (typeof input !== "object" || input === null || Array.isArray(input)) return null;
	const record = input as Record<string, unknown>;
	const validOperations: TaskOperation[] = [
		"run",
		"retry",
		"stop",
		"delete",
		"resume",
		"resume-with-text",
		"delete-session",
	];
	if (
		typeof record.operation !== "string" ||
		!validOperations.includes(record.operation as TaskOperation) ||
		typeof record.projectId !== "string" ||
		typeof record.taskId !== "string"
	) {
		return null;
	}
	return {
		operation: record.operation as TaskOperation,
		projectId: record.projectId,
		taskId: record.taskId,
		...(record.operation === "resume-with-text" && typeof record.text === "string" ? { text: record.text } : {}),
	};
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

function getTaskOperationDetail(
	operation: TaskOperation,
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
		case "run":
			return {
				label: t("batchTasksApproval.taskRunLabel"),
				title: t("batchTasksApproval.taskRunTitle"),
				summary: t("batchTasksApproval.taskRunSummary"),
				icon: "icon-[mdi--play-circle-outline]",
				description: t("batchTasksApproval.taskRunDescription"),
			};
		case "retry":
			return {
				label: t("batchTasksApproval.taskRetryLabel"),
				title: t("batchTasksApproval.taskRetryTitle"),
				summary: t("batchTasksApproval.taskRetrySummary"),
				icon: "icon-[mdi--refresh]",
				description: t("batchTasksApproval.taskRetryDescription"),
				warning: t("batchTasksApproval.taskRetryWarning"),
				destructive: true,
			};
		case "stop":
			return {
				label: t("batchTasksApproval.taskStopLabel"),
				title: t("batchTasksApproval.taskStopTitle"),
				summary: t("batchTasksApproval.taskStopSummary"),
				icon: "icon-[mdi--stop-circle-outline]",
				description: t("batchTasksApproval.taskStopDescription"),
				warning: t("batchTasksApproval.taskStopWarning"),
				destructive: true,
			};
		case "delete":
			return {
				label: t("batchTasksApproval.taskDeleteLabel"),
				title: t("batchTasksApproval.taskDeleteTitle"),
				summary: t("batchTasksApproval.taskDeleteSummary"),
				icon: "icon-[mdi--delete-outline]",
				description: t("batchTasksApproval.taskDeleteDescription"),
				warning: t("batchTasksApproval.taskDeleteWarning"),
				destructive: true,
			};
		case "resume":
			return {
				label: t("batchTasksApproval.taskResumeLabel"),
				title: t("batchTasksApproval.taskResumeTitle"),
				summary: t("batchTasksApproval.taskResumeSummary"),
				icon: "icon-[mdi--play-circle-outline]",
				description: t("batchTasksApproval.taskResumeDescription"),
			};
		case "resume-with-text":
			return {
				label: t("batchTasksApproval.taskResumeWithTextLabel"),
				title: t("batchTasksApproval.taskResumeWithTextTitle"),
				summary: t("batchTasksApproval.taskResumeWithTextSummary"),
				icon: "icon-[mdi--message-plus-outline]",
				description: t("batchTasksApproval.taskResumeWithTextDescription"),
			};
		case "delete-session":
			return {
				label: t("batchTasksApproval.taskDeleteSessionLabel"),
				title: t("batchTasksApproval.taskDeleteSessionTitle"),
				summary: t("batchTasksApproval.taskDeleteSessionSummary"),
				icon: "icon-[mdi--chat-remove-outline]",
				description: t("batchTasksApproval.taskDeleteSessionDescription"),
				warning: t("batchTasksApproval.taskDeleteSessionWarning"),
				destructive: true,
			};
	}
}

export interface BatchTasksTaskApprovalModel {
	readonly approvalId: string;
	readonly frame: Omit<BatchTasksApprovalFrameViewProps, "children">;
	readonly hasInput: boolean;
	readonly rawInput: unknown;
	readonly taskName: string;
	readonly projectName: string;
	readonly statusLabel: string | null;
	readonly sourceFolderLabel: string;
	readonly sourcePath: string;
	readonly taskIdLabel: string;
	readonly taskId: string;
	readonly relatedSessionLabel: string;
	readonly relatedSessionValue: string;
	readonly afterActionTitle: string;
	readonly description: string;
	readonly icon: string;
	readonly showResumeText: boolean;
	readonly resumeTextLabel: string;
	readonly resumeText: string;
	readonly onResumeTextChange: (value: string) => void;
	readonly lastErrorLabel: string;
	readonly lastError: string | null;
	readonly warning: string | null;
}

export function useBatchTasksTaskApprovalModel(): BatchTasksTaskApprovalModel | null {
	const { t } = useTranslation("common");
	const approval = useActionApproval("batch-tasks.task");
	const projects = useAtomValue(batchProjectsAtom);
	const input = approval ? parseTaskInput(approval.request.input) : null;
	const project = input ? projects.find((item) => item.id === input.projectId) : undefined;
	const task = input ? project?.tasks.find((item) => item.id === input.taskId) : undefined;
	const detail = input ? getTaskOperationDetail(input.operation, t) : undefined;
	const isEditable = input?.operation === "resume-with-text";
	const [resumeText, setResumeText] = useState(input?.text?.trim() || t("batchTasksApproval.resumeDefaultText"));

	if (!approval) return null;

	const { request, responding, error, approve, reject } = approval;
	const approveInput = (): void => {
		if (!input || !isEditable) {
			approve();
			return;
		}
		const originalInput = request.input as Record<string, DesktopActionJsonValue>;
		approve({ ...originalInput, text: resumeText.trim() || t("batchTasksApproval.resumeDefaultText") });
	};

	return {
		approvalId: request.approvalId,
		frame: {
			presentation: isEditable ? "drawer" : "dialog",
			title: detail?.title ?? t("batchTasksApproval.taskFallbackTitle"),
			summary: detail?.summary ?? request.summary,
			icon: detail?.icon ?? "icon-[mdi--checkbox-marked-circle-outline]",
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
			onApprove: approveInput,
		},
		hasInput: Boolean(input && detail),
		rawInput: request.input,
		taskName: task?.name ?? t("batchTasksApproval.taskNotFoundInCurrentList"),
		projectName: project?.name ?? input?.projectId ?? "",
		statusLabel: task ? getTaskStatusLabel(task.status, t) : null,
		sourceFolderLabel: t("batchTasksApproval.sourceFolder"),
		sourcePath: task?.sourcePath ?? t("batchTasksApproval.unknown"),
		taskIdLabel: t("batchTasksApproval.taskId"),
		taskId: input?.taskId ?? "",
		relatedSessionLabel: t("batchTasksApproval.relatedSession"),
		relatedSessionValue: task?.sessionPath ? t("batchTasksApproval.yes") : t("batchTasksApproval.no"),
		afterActionTitle: t("batchTasksApproval.afterActionTitle"),
		description: detail?.description ?? "",
		icon: detail?.icon ?? "icon-[mdi--checkbox-marked-circle-outline]",
		showResumeText: input?.operation === "resume-with-text",
		resumeTextLabel: t("batchTasksApproval.resumeTextLabel"),
		resumeText,
		onResumeTextChange: setResumeText,
		lastErrorLabel: t("batchTasksApproval.lastError"),
		lastError: task?.error ?? null,
		warning: detail?.warning ?? null,
	};
}
