import { confirmDialogAtom, openSessionFnRef, runningTaskIdsAtom, type ScheduledTask } from "@shared/store/atoms";
import { useAtomValue, useSetAtom } from "jotai";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
	type AutomationDraft,
	type AutomationDraftDefaults,
	automationDraftFrom,
	automationDraftToInput,
	automationDraftToPatch,
	canSubmitAutomationDraft,
	emptyAutomationDraft,
} from "../automation-draft";
import { type AutomationTaskTone, automationTaskTone } from "../automation-status";
import { useAutomationDraftDefaults } from "./useAutomationDraftDefaults";
import type { AutomationPane } from "./useAutomationPageModel";
import { useScheduledTasks } from "./useScheduledTasks";

export interface AutomationDetailModel {
	readonly mode: "create" | "edit";
	readonly taskId: string | null;
	readonly draft: AutomationDraft;
	readonly dirty: boolean;
	readonly canSubmit: boolean;
	readonly submitting: boolean;
	/** 保存或创建被主进程拒绝时的原因（如一次性任务时间已过、项目不存在）。 */
	readonly error: string | null;
	readonly tone: AutomationTaskTone | "draft";
	readonly statusLabel: string;
	readonly enabled: boolean;
	readonly running: boolean;
	readonly canOpenChat: boolean;
	readonly onChange: (value: AutomationDraft) => void;
	readonly onSubmit: () => void;
	readonly onDiscard: () => void;
	readonly onToggleEnabled: () => void;
	readonly onRunNow: () => void;
	readonly onDelete: () => void;
	readonly onOpenChat: () => void;
}

interface UseAutomationDetailModelOptions {
	readonly pane: Exclude<AutomationPane, { kind: "none" }>;
	readonly onClose: () => void;
	readonly onCreated: (task: ScheduledTask) => void;
}

function computeBaseline(
	task: ScheduledTask | undefined,
	createDraft: Partial<AutomationDraft> | undefined,
	defaults: AutomationDraftDefaults,
): AutomationDraft {
	const now = { ...defaults, now: Date.now() };
	return task ? automationDraftFrom(task, now) : { ...emptyAutomationDraft(now), ...createDraft };
}

function parseCreateDraft(key: string): Partial<AutomationDraft> | undefined {
	return key ? (JSON.parse(key) as Partial<AutomationDraft>) : undefined;
}

function sameDraft(a: AutomationDraft, b: AutomationDraft): boolean {
	return JSON.stringify(a) === JSON.stringify(b);
}

export function useAutomationDetailModel({
	pane,
	onClose,
	onCreated,
}: UseAutomationDetailModelOptions): AutomationDetailModel {
	const { t } = useTranslation("automation");
	const { createTask, updateTask, toggleTask, runNow, deleteTask } = useScheduledTasks();
	const runningTaskIds = useAtomValue(runningTaskIdsAtom);
	const setConfirmDialog = useSetAtom(confirmDialogAtom);
	const defaults = useAutomationDraftDefaults();
	const task = pane.kind === "task" ? pane.task : undefined;
	const identity = pane.kind === "task" ? `task:${pane.task.id}` : `create:${pane.key}`;

	// 按内容而不是引用跟踪预填：调用方每次渲染传一个新对象也不会让基线反复重算。
	const createDraftKey = pane.kind === "create" && pane.draft ? JSON.stringify(pane.draft) : "";
	const [baseline, setBaseline] = useState<AutomationDraft>(() =>
		computeBaseline(task, parseCreateDraft(createDraftKey), defaults),
	);
	const [draft, setDraft] = useState<AutomationDraft>(baseline);
	const [submitting, setSubmitting] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const draftRef = useRef(draft);
	draftRef.current = draft;
	const baselineRef = useRef(baseline);
	baselineRef.current = baseline;

	// 换了任务或重新点「创建」时重置；同一任务被外部改动（暂停、回写绑定会话）时，
	// 没有未保存的修改就跟上最新配置，有修改则保留用户的编辑。
	const lastIdentityRef = useRef(identity);
	useEffect(() => {
		const next = computeBaseline(task, parseCreateDraft(createDraftKey), defaults);
		const switched = lastIdentityRef.current !== identity;
		lastIdentityRef.current = identity;
		if (switched || sameDraft(draftRef.current, baselineRef.current)) setDraft(next);
		if (switched) setError(null);
		setBaseline(next);
	}, [createDraftKey, defaults, identity, task]);

	return useMemo(() => {
		const running = task ? runningTaskIds.has(task.id) : false;
		const tone = task ? automationTaskTone(task, running) : ("draft" as const);
		const dirty = !sameDraft(draft, baseline);
		const canSubmit = canSubmitAutomationDraft(draft) && (pane.kind === "create" || dirty) && !submitting;
		const canOpenChat = Boolean(
			task && (task.lastRunAt !== null || (task.runTarget.mode === "same-session" && task.runTarget.sessionPath)),
		);
		return {
			mode: pane.kind === "create" ? "create" : "edit",
			taskId: task?.id ?? null,
			draft,
			dirty,
			canSubmit,
			submitting,
			error,
			tone,
			statusLabel: t(`detail.status.${tone}`),
			enabled: task?.enabled ?? draft.enabled,
			running,
			canOpenChat,
			onChange: (value) => {
				setDraft(value);
				setError(null);
			},
			onSubmit: () => {
				if (!canSubmit) return;
				setSubmitting(true);
				setError(null);
				const fail = (reason: unknown): void => setError(ipcErrorMessage(reason));
				if (!task) {
					void createTask(automationDraftToInput(draft))
						.then(onCreated, fail)
						.finally(() => setSubmitting(false));
					return;
				}
				// 启用状态由顶栏开关单独控制，保存编辑内容时不覆盖它。
				const { enabled: _enabled, ...patch } = automationDraftToPatch(draft);
				void updateTask(task.id, patch)
					.then(() => setBaseline(draft), fail)
					.finally(() => setSubmitting(false));
			},
			onDiscard: () => {
				setDraft(baseline);
				setError(null);
			},
			onToggleEnabled: () => {
				if (task) void toggleTask(task.id);
			},
			onRunNow: () => {
				if (task) void runNow(task.id);
			},
			onDelete: () => {
				if (!task) return;
				setConfirmDialog({
					title: t("confirm.deleteTitle", { name: task.name }),
					message: t("confirm.deleteMsg"),
					confirmLabel: t("confirm.delete"),
					cancelLabel: t("confirm.cancel"),
					variant: "danger",
					onConfirm: () => {
						void deleteTask(task.id).then(onClose);
					},
				});
			},
			onOpenChat: () => {
				if (!task || !openSessionFnRef.current) return;
				const open = openSessionFnRef.current;
				if (task.runTarget.mode === "same-session" && task.runTarget.sessionPath) {
					void open(task.runTarget.projectCwd, task.runTarget.sessionPath);
					return;
				}
				// 每次新建会话：打开最近一次有会话的运行。
				void window.vetta.scheduler.getRecords(task.id).then((records) => {
					const latest = records.find((record) => record.sessionPath && record.cwd);
					if (latest?.sessionPath && latest.cwd) void open(latest.cwd, latest.sessionPath);
				});
			},
		};
	}, [
		baseline,
		createTask,
		deleteTask,
		draft,
		error,
		onClose,
		onCreated,
		pane.kind,
		runNow,
		runningTaskIds,
		setConfirmDialog,
		submitting,
		t,
		task,
		toggleTask,
		updateTask,
	]);
}

/** IPC 抛回的错误带着「Error invoking remote method …: XxxError:」前缀，只留主进程给的原因。 */
function ipcErrorMessage(reason: unknown): string {
	const message = reason instanceof Error ? reason.message : String(reason);
	return message.replace(/^Error invoking remote method '[^']+': (?:\w*Error: )?/, "");
}
