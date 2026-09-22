import type { ScheduledTask } from "@shared/store/atoms";
import { useEffect, useMemo, useState } from "react";
import {
	type AutomationDraft,
	automationDraftFrom,
	automationDraftToInput,
	automationDraftToPatch,
	canSubmitAutomationDraft,
	emptyAutomationDraft,
} from "../automation-draft";
import { useAutomationDraftDefaults } from "./useAutomationDraftDefaults";
import { useScheduledTasks } from "./useScheduledTasks";

export interface TaskFormModel {
	readonly canSubmit: boolean;
	readonly data: AutomationDraft;
	readonly onChange: (value: AutomationDraft) => void;
	readonly onSubmit: () => void;
}

interface UseTaskFormModelOptions {
	readonly open: boolean;
	readonly task: ScheduledTask | undefined;
	/** Prefill for create mode (e.g. recommended templates). Ignored when `task` is set. */
	readonly initialDraft?: Partial<AutomationDraft> | undefined;
	readonly onClose: () => void;
}

export function useTaskFormModel({ open, task, initialDraft, onClose }: UseTaskFormModelOptions): TaskFormModel {
	const { createTask, updateTask } = useScheduledTasks();
	const defaults = useAutomationDraftDefaults();
	const [data, setData] = useState<AutomationDraft>(() => emptyAutomationDraft(defaults));

	useEffect(() => {
		if (!open) return;
		const now = { ...defaults, now: Date.now() };
		setData(task ? automationDraftFrom(task, now) : { ...emptyAutomationDraft(now), ...initialDraft });
	}, [defaults, initialDraft, open, task]);

	const canSubmit = canSubmitAutomationDraft(data);

	return useMemo(
		() => ({
			canSubmit,
			data,
			onChange: setData,
			onSubmit: (): void => {
				if (!canSubmit) return;
				if (task) {
					void updateTask(task.id, automationDraftToPatch(data)).then(onClose);
					return;
				}
				void createTask(automationDraftToInput(data)).then(onClose);
			},
		}),
		[canSubmit, createTask, data, onClose, task, updateTask],
	);
}
