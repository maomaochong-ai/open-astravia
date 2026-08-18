import { useThemeComponent } from "@vetta/theme-sdk";
import {
	BatchTasksApprovalFrameView,
	BatchTasksTaskApprovalView as ThemeBatchTasksTaskApprovalView,
} from "@vetta/theme-ui/action-approval";
import type { BatchTasksTaskApprovalModel } from "./useBatchTasksTaskApprovalModel";

export function BatchTasksTaskApprovalView(model: BatchTasksTaskApprovalModel): JSX.Element {
	const ThemedBatchTasksApprovalFrameView = useThemeComponent(
		"root.approval.batchTasksFrameView",
		BatchTasksApprovalFrameView,
	);

	return (
		<ThemeBatchTasksTaskApprovalView
			frame={model.frame}
			Frame={ThemedBatchTasksApprovalFrameView}
			hasInput={model.hasInput}
			taskName={model.taskName}
			projectName={model.projectName}
			statusLabel={model.statusLabel ?? undefined}
			sourceFolderLabel={model.sourceFolderLabel}
			sourcePath={model.sourcePath}
			taskIdLabel={model.taskIdLabel}
			taskId={model.taskId}
			relatedSessionLabel={model.relatedSessionLabel}
			relatedSessionValue={model.relatedSessionValue}
			icon={model.icon}
			afterActionTitle={model.afterActionTitle}
			description={model.description}
			showResumeText={model.showResumeText}
			resumeTextLabel={model.resumeTextLabel}
			approvalId={model.approvalId}
			resumeText={model.resumeText}
			onResumeTextChange={model.onResumeTextChange}
			lastError={model.lastError}
			lastErrorLabel={model.lastErrorLabel}
			warning={model.warning}
			rawInput={model.rawInput}
		/>
	);
}
