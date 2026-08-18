import { useThemeComponent } from "@vetta/theme-sdk";
import { SchedulerUpdateApprovalView as ThemeSchedulerUpdateApprovalView } from "@vetta/theme-ui/action-approval";
import { SchedulerEditApprovalDrawerView } from "./SchedulerEditApprovalDrawerView";
import type { SchedulerUpdateApprovalModel } from "./useSchedulerUpdateApprovalModel";

export function SchedulerUpdateApprovalView(model: SchedulerUpdateApprovalModel): JSX.Element {
	const ThemedSchedulerEditApprovalDrawerView = useThemeComponent(
		"root.approval.schedulerEditView",
		SchedulerEditApprovalDrawerView,
	);
	return (
		<ThemeSchedulerUpdateApprovalView
			EditView={ThemedSchedulerEditApprovalDrawerView}
			drawerProps={model.drawer}
		/>
	);
}
