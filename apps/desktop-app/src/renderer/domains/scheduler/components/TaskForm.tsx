import type { ScheduledTask } from "@shared/store/atoms";
import { useTranslation } from "react-i18next";
import { useTaskFormModel } from "../hooks/useTaskFormModel";
import type { SchedulerTaskDraft } from "./SchedulerTaskFields";
import { TaskFormDialogView } from "./TaskFormDialogView";

interface TaskFormDialogProps {
	open: boolean;
	task?: ScheduledTask;
	/** Prefill for create mode (recommended templates). Ignored when editing. */
	initialDraft?: SchedulerTaskDraft;
	onClose: () => void;
}

export function TaskFormDialog({
	open,
	task,
	initialDraft,
	onClose,
}: TaskFormDialogProps): JSX.Element {
	const { t } = useTranslation("automation");
	const model = useTaskFormModel({ open, task, initialDraft, onClose });
	return (
		<TaskFormDialogView
			{...model}
			isEdit={Boolean(task)}
			labels={{
				cancel: t("dialog.cancel"),
				create: t("dialog.create"),
				namePlaceholderEdit: t("dialog.namePlaceholderEdit"),
				namePlaceholderNew: t("dialog.namePlaceholderNew"),
				save: t("dialog.save"),
			}}
			open={open}
			onClose={onClose}
		/>
	);
}
