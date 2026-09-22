import { TaskFormDialogView as ThemeTaskFormDialogView } from "@vetta-org/theme-ui/scheduler";
import { type AutomationDraft, SchedulerTaskFields } from "./SchedulerTaskFields";

export interface TaskFormDialogViewLabels {
	readonly cancel: string;
	readonly create: string;
	readonly namePlaceholderEdit: string;
	readonly namePlaceholderNew: string;
	readonly save: string;
}

export interface TaskFormDialogViewProps {
	readonly canSubmit: boolean;
	readonly data: AutomationDraft;
	readonly isEdit: boolean;
	readonly labels: TaskFormDialogViewLabels;
	readonly open: boolean;
	readonly onChange: (value: AutomationDraft) => void;
	readonly onClose: () => void;
	readonly onSubmit: () => void;
}

export function TaskFormDialogView({
	canSubmit,
	data,
	isEdit,
	labels,
	open,
	onChange,
	onClose,
	onSubmit,
}: TaskFormDialogViewProps): JSX.Element {
	return (
		<ThemeTaskFormDialogView
			canSubmit={canSubmit}
			isEdit={isEdit}
			open={open}
			onClose={onClose}
			onSubmit={onSubmit}
			labels={{
				cancel: labels.cancel,
				create: labels.create,
				save: labels.save,
			}}
			fields={
				<SchedulerTaskFields
					value={data}
					onChange={onChange}
					namePlaceholder={isEdit ? labels.namePlaceholderEdit : labels.namePlaceholderNew}
				/>
			}
		/>
	);
}
