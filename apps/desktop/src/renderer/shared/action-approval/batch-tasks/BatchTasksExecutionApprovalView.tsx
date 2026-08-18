import { useThemeComponent } from "@vetta/theme-sdk";
import { BatchTasksExecutionApprovalView as ThemeBatchTasksExecutionApprovalView } from "@vetta/theme-ui/action-approval";
import { BatchTasksApprovalFrameView } from "./BatchTasksApprovalFrameView";
import type { BatchTasksExecutionApprovalModel } from "./useBatchTasksExecutionApprovalModel";

export function BatchTasksExecutionApprovalView(model: BatchTasksExecutionApprovalModel): JSX.Element {
	const ThemedBatchTasksApprovalFrameView = useThemeComponent(
		"root.approval.batchTasksFrameView",
		BatchTasksApprovalFrameView,
	);

	return (
		<ThemeBatchTasksExecutionApprovalView
			Frame={ThemedBatchTasksApprovalFrameView}
			frameProps={model.frame}
			hasInput={model.hasInput}
			rawInput={model.rawInput}
			projectName={model.projectName}
			projectId={model.projectId}
			totalTasksLabel={model.totalTasksLabel}
			totalTasksCaption={model.totalTasksCaption}
			statusCounts={model.statusCounts}
			icon={model.icon}
			afterActionTitle={model.afterActionTitle}
			description={model.description}
			affectedCount={model.affectedCount}
			estimatedImpactLabel={model.estimatedImpactLabel}
			showSelectedTasks={model.showSelectedTasks}
			selectedTasksTitle={model.selectedTasksTitle}
			selectedTasksCountLabel={model.selectedTasksCountLabel}
			selectedTasks={model.selectedTasks}
			partialWarning={model.partialWarning}
			warning={model.warning}
		/>
	);
}
