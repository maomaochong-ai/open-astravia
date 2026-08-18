import {
	SchedulerEditApprovalDrawerView as ThemeSchedulerEditApprovalDrawerView,
	type SchedulerEditApprovalDrawerViewLabels,
	type SchedulerEditApprovalDrawerViewProps as ThemeProps,
} from "@vetta/theme-ui/action-approval";
import {
	SchedulerApprovalFields,
	type SchedulerEditableData,
} from "./SchedulerApprovalFields";

export type { SchedulerEditApprovalDrawerViewLabels };

export interface SchedulerEditApprovalDrawerViewProps
	extends Omit<ThemeProps, "fields" | "canSubmit"> {
	readonly value?: SchedulerEditableData;
	readonly onChange?: (value: SchedulerEditableData) => void;
	readonly onSubmit?: () => void;
}

export function SchedulerEditApprovalDrawerView({
	value,
	onChange,
	onSubmit,
	...rest
}: SchedulerEditApprovalDrawerViewProps): JSX.Element {
	const canSubmit = Boolean(value && onSubmit);
	return (
		<ThemeSchedulerEditApprovalDrawerView
			{...rest}
			canSubmit={canSubmit}
			onSubmit={onSubmit}
			fields={
				value && onChange ? (
					<SchedulerApprovalFields value={value} onChange={onChange} />
				) : undefined
			}
		/>
	);
}
