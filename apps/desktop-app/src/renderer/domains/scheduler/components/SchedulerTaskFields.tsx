import type {
	ExecutionModeOverride,
	SelectedSkill,
} from "@shared/store/atoms";
import { useSchedulerTaskFieldsModel } from "../hooks/useSchedulerTaskFieldsModel";
import { SchedulerTaskFieldsView } from "./SchedulerTaskFieldsView";

export interface SchedulerTaskDraft {
	name?: string;
	prompt?: string;
	cron?: string;
	isOnce?: boolean;
	enabled?: boolean;
	cwd?: string;
	modelKey?: string | null;
	executionMode?: ExecutionModeOverride;
	skill?: SelectedSkill | null;
}

interface SchedulerTaskFieldsProps {
	value: SchedulerTaskDraft;
	onChange: (value: SchedulerTaskDraft) => void;
	namePlaceholder?: string;
	showEnabled?: boolean;
	showWorkDirSelector?: boolean;
	promptMinHeight?: number;
}

export function SchedulerTaskFields({
	value,
	onChange,
	namePlaceholder,
	showEnabled = false,
	showWorkDirSelector = true,
	promptMinHeight = 140,
}: SchedulerTaskFieldsProps): JSX.Element {
	return (
		<SchedulerTaskFieldsView
			{...useSchedulerTaskFieldsModel({ namePlaceholder, onChange, value })}
			value={value}
			showEnabled={showEnabled}
			showWorkDirSelector={showWorkDirSelector}
			promptMinHeight={promptMinHeight}
		/>
	);
}
