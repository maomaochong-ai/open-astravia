import { useThemeComponent } from "@vetta/theme-sdk";
import { useTranslation } from "react-i18next";
import { SchedulerActionApprovalDialogView } from "./SchedulerActionApprovalDialogView";
import { useActionApproval } from "../useActionApproval";

interface DeleteTaskInput {
	operation: "delete";
	taskId: string;
	approvalUi?: string;
}

export function SchedulerDeleteApproval(): JSX.Element | null {
	const { t } = useTranslation("common");
	const approval = useActionApproval("scheduler.delete");
	if (!approval) return null;
	const { request, responding, error, approve, reject } = approval;
	const input = request.input as unknown as DeleteTaskInput;
	const ThemedSchedulerActionApprovalDialogView = useThemeComponent(
		"root.approval.schedulerActionView",
		SchedulerActionApprovalDialogView,
	);

	return (
		<ThemedSchedulerActionApprovalDialogView
			title={t("schedulerApproval.deleteTitle")}
			summary={request.summary}
			taskId={input?.taskId}
			rawInput={request.input}
			detail={{
				label: t("schedulerApproval.deleteLabel"),
				icon: "icon-[mdi--clock-remove-outline]",
				descriptionTitle: t("schedulerApproval.deleteDescriptionTitle"),
				description: t("schedulerApproval.deleteDescription"),
				warning: t("schedulerApproval.deleteWarning"),
				destructive: true,
			}}
			error={error}
			responding={responding}
			countdown={approval.countdown.formatted}
			labels={{
				reject: t("actionApproval.reject"),
				confirm: t("schedulerApproval.confirmDelete"),
				responding: t("schedulerApproval.deleting"),
				permission: t("actionApproval.permission", { permission: request.permission }),
				fallbackAction: t("schedulerApproval.fallbackAction"),
				targetTask: t("schedulerApproval.deleteTargetTask"),
				rawInput: t("schedulerApproval.rawInput"),
			}}
			onReject={reject}
			onApprove={() => approve()}
		/>
	);
}
