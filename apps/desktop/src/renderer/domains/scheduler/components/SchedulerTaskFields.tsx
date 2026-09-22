import type { AutomationDraft } from "../automation-draft";
import { useSchedulerTaskFieldsModel } from "../hooks/useSchedulerTaskFieldsModel";
import { SchedulerTaskFieldsView } from "./SchedulerTaskFieldsView";

export type { AutomationDraft } from "../automation-draft";

interface SchedulerTaskFieldsProps {
	value: AutomationDraft;
	onChange: (value: AutomationDraft) => void;
	namePlaceholder?: string;
	showEnabled?: boolean;
	promptMinHeight?: number;
}

export function SchedulerTaskFields({
	value,
	onChange,
	namePlaceholder,
	showEnabled = false,
	promptMinHeight = 120,
}: SchedulerTaskFieldsProps): JSX.Element {
	return (
		<SchedulerTaskFieldsView
			{...useSchedulerTaskFieldsModel({ namePlaceholder, onChange, value, showEnabled })}
			promptMinHeight={promptMinHeight}
		/>
	);
}
