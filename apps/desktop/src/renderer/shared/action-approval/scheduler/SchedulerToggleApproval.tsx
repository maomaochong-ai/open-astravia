import { useThemeComponent } from "@vetta/theme-sdk";
import { useTranslation } from "react-i18next";
import { SchedulerActionApprovalDialogView } from "./SchedulerActionApprovalDialogView";
import { useActionApproval } from "../useActionApproval";

interface ToggleTaskInput {
	operation: "enable" | "disable";
	taskId: string;
	approvalUi?: string;
}

const operationDetails = {
	enable: {
		labelKey: "schedulerApproval.enableLabel",
		icon: "icon-[mdi--play-circle-outline]",
		descriptionKey: "schedulerApproval.enableDescription",
		titleKey: "schedulerApproval.enableTitle",
	},
	disable: {
		labelKey: "schedulerApproval.disableLabel",
		icon: "icon-[mdi--pause-circle-outline]",
		descriptionKey: "schedulerApproval.disableDescription",
		titleKey: "schedulerApproval.disableTitle",
	},
} as const satisfies Record<
	ToggleTaskInput["operation"],
	{ labelKey: string; icon: string; descriptionKey: string; titleKey: string }
>;

export function SchedulerToggleApproval(): JSX.Element | null {
	const { t } = useTranslation("common");
	const approval = useActionApproval("scheduler.toggle");
	if (!approval) return null;
	const { request, responding, error, approve, reject } = approval;

	const input = request.input as unknown as ToggleTaskInput;
	const detail = input?.operation ? operationDetails[input.operation] : undefined;
	const ThemedSchedulerActionApprovalDialogView = useThemeComponent(
		"root.approval.schedulerActionView",
		SchedulerActionApprovalDialogView,
	);

	return (
		<ThemedSchedulerActionApprovalDialogView
			title={detail ? t(detail.titleKey) : t("schedulerApproval.toggleTitle")}
			summary={request.summary}
			taskId={input?.taskId}
			rawInput={request.input}
			detail={
				detail
					? {
							label: t(detail.labelKey),
							icon: detail.icon,
							descriptionTitle: t("schedulerApproval.operationDescription"),
							description: t(detail.descriptionKey),
						}
					: undefined
			}
			error={error}
			responding={responding}
			countdown={approval.countdown.formatted}
			labels={{
				reject: t("actionApproval.reject"),
				confirm: t("schedulerApproval.confirmAction", {
					action: detail ? t(detail.labelKey) : t("schedulerApproval.fallbackAction"),
				}),
				responding: t("actionApproval.processing"),
				permission: t("actionApproval.permission", { permission: request.permission }),
				fallbackAction: t("schedulerApproval.fallbackAction"),
				targetTask: t("schedulerApproval.targetTask"),
				rawInput: t("schedulerApproval.rawInput"),
			}}
			onReject={reject}
			onApprove={() => approve()}
		/>
	);
}
