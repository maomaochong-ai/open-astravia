import { type ScheduledTask, scheduledTasksAtom } from "@shared/store/atoms";
import { useAtomValue } from "jotai";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useActionApproval } from "../useActionApproval";
import { type SchedulerEditableData, toSchedulerApprovalJsonData } from "./SchedulerApprovalFields";
import type { SchedulerEditApprovalDrawerViewProps } from "./SchedulerEditApprovalDrawerView";

interface UpdateTaskData extends SchedulerEditableData {
	skill?: { name: string; alias?: string; type: "skill" | "scene" } | null;
}

interface UpdateTaskInput {
	operation: "update";
	taskId: string;
	data: UpdateTaskData;
	approvalUi?: string;
}

export type SchedulerUpdateApprovalPhase = "loading" | "not_found" | "ready";

export interface SchedulerUpdateApprovalModel {
	readonly approvalId: string;
	readonly phase: SchedulerUpdateApprovalPhase;
	readonly drawer: SchedulerEditApprovalDrawerViewProps;
}

export function useSchedulerUpdateApprovalModel(): SchedulerUpdateApprovalModel | null {
	const approval = useActionApproval("scheduler.update");
	const tasks = useAtomValue(scheduledTasksAtom);
	const { t } = useTranslation("common");
	const input = (approval?.request.input as unknown as UpdateTaskInput | undefined) ?? null;
	const cachedTask = input ? tasks.find((candidate) => candidate.id === input.taskId) : undefined;
	const [task, setTask] = useState<ScheduledTask | undefined>(cachedTask);
	const [loading, setLoading] = useState(!cachedTask && !!approval);
	const [loadError, setLoadError] = useState<string | null>(null);

	const initialData = useMemo<UpdateTaskData | null>(() => {
		if (!task || !input) return null;
		return {
			name: task.name,
			prompt: task.prompt,
			cron: task.cron,
			isOnce: task.isOnce,
			enabled: task.enabled,
			cwd: task.cwd,
			modelKey: task.modelKey,
			executionMode: task.executionMode,
			skill: task.skill,
			...input.data,
		};
	}, [input, task]);

	const [data, setData] = useState<SchedulerEditableData | null>(null);

	useEffect(() => {
		setTask(cachedTask);
		setLoading(!cachedTask && !!approval);
		setLoadError(null);
		setData(null);
	}, [approval?.request.approvalId, cachedTask, approval]);

	useEffect(() => {
		if (!approval || !input) return;
		console.info(
			`[action-approval:scheduler.update] request ${JSON.stringify({
				approvalId: approval.request.approvalId,
				input,
				cachedTaskCount: cachedTask ? 1 : 0,
				cachedTask,
			})}`,
		);
	}, [approval, cachedTask, input]);

	useEffect(() => {
		if (!approval || !input) return;
		if (cachedTask) {
			console.info(
				`[action-approval:scheduler.update] source ${JSON.stringify({
					approvalId: approval.request.approvalId,
					source: "atom",
					task: cachedTask,
				})}`,
			);
			return;
		}
		let cancelled = false;
		void window.vetta.scheduler
			.getTasks()
			.then((listed) => {
				if (cancelled) return;
				const currentTask = listed.find((candidate) => candidate.id === input.taskId);
				console.info(
					`[action-approval:scheduler.update] query ${JSON.stringify({
						approvalId: approval.request.approvalId,
						requestedTaskId: input.taskId,
						returnedTaskIds: listed.map((candidate) => candidate.id),
						matchedTask: currentTask,
					})}`,
				);
				setTask(currentTask);
				if (!currentTask) setLoadError(t("schedulerApproval.updateNotFound"));
			})
			.catch((error: unknown) => {
				console.error(
					`[action-approval:scheduler.update] query-failed ${JSON.stringify({
						approvalId: approval.request.approvalId,
						requestedTaskId: input.taskId,
						error,
					})}`,
				);
				if (!cancelled) setLoadError(t("schedulerApproval.updateLoadFailed"));
			})
			.finally(() => {
				if (!cancelled) setLoading(false);
			});
		return () => {
			cancelled = true;
		};
	}, [approval, cachedTask, input, t]);

	useEffect(() => {
		if (!initialData) return;
		setData(initialData);
		if (!approval) return;
		console.info(
			`[action-approval:scheduler.update] merged ${JSON.stringify({
				approvalId: approval.request.approvalId,
				currentTask: task,
				agentPatch: input?.data,
				mergedData: initialData,
			})}`,
		);
	}, [approval, initialData, input?.data, task]);

	if (!approval || !input) return null;

	const { request, responding, error, approve, reject } = approval;
	const baseLabels = {
		reject: t("actionApproval.reject"),
		submit: t("schedulerApproval.confirmUpdate"),
		submitting: t("schedulerApproval.updating"),
		taskId: t("schedulerApproval.taskId"),
		permission: t("actionApproval.permission", { permission: request.permission }),
	};

	if (loading) {
		return {
			approvalId: request.approvalId,
			phase: "loading",
			drawer: {
				title: t("schedulerApproval.updateTitle"),
				description: request.summary,
				loadingMessage: t("schedulerApproval.loadingCurrentTask"),
				responding,
				countdown: approval.countdown.formatted,
				labels: baseLabels,
				onReject: reject,
			},
		};
	}

	if (!task || !initialData || !data) {
		return {
			approvalId: request.approvalId,
			phase: "not_found",
			drawer: {
				title: t("schedulerApproval.updateTitle"),
				description: request.summary,
				loadError,
				responding,
				countdown: approval.countdown.formatted,
				labels: baseLabels,
				onReject: reject,
			},
		};
	}

	return {
		approvalId: request.approvalId,
		phase: "ready",
		drawer: {
			title: t("schedulerApproval.updateTitle"),
			description: request.summary,
			value: data,
			taskId: input.taskId,
			error,
			responding,
			countdown: approval.countdown.formatted,
			labels: baseLabels,
			onChange: setData,
			onReject: reject,
			onSubmit: () => {
				const approvedInput = {
					operation: "update" as const,
					taskId: input.taskId,
					data: toSchedulerApprovalJsonData({ ...initialData, ...data }),
					approvalUi: input.approvalUi ?? "scheduler.update",
				};
				console.info(
					`[action-approval:scheduler.update] submit ${JSON.stringify({
						approvalId: request.approvalId,
						input: approvedInput,
					})}`,
				);
				approve(approvedInput);
			},
		},
	};
}
