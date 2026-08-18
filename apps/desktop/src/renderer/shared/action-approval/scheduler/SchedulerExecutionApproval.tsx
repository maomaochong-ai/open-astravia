import { useThemeComponent } from "@vetta/theme-sdk";
import { useTranslation } from "react-i18next";
import { SchedulerActionApprovalDialogView } from "./SchedulerActionApprovalDialogView";
import { useActionApproval, type ActiveActionApproval } from "../useActionApproval";

interface ExecutionTaskInput {
	operation: "run-now" | "abort";
	taskId: string;
	approvalUi?: string;
}

const operationDetails = {
	"run-now": {
		labelKey: "schedulerApproval.runNowLabel",
		icon: "icon-[mdi--play-circle-outline]",
		descriptionKey: "schedulerApproval.runNowDescription",
		titleKey: "schedulerApproval.runNowTitle",
		warningKey: undefined,
		destructive: false,
	},
	abort: {
		labelKey: "schedulerApproval.abortLabel",
		icon: "icon-[mdi--stop-circle-outline]",
		descriptionKey: "schedulerApproval.abortDescription",
		warningKey: "schedulerApproval.abortWarning",
		destructive: true,
		titleKey: "schedulerApproval.abortTitle",
	},
} as const satisfies Record<
	ExecutionTaskInput["operation"],
	{ labelKey: string; icon: string; descriptionKey: string; warningKey?: string; destructive?: boolean; titleKey: string }
>;

export function SchedulerExecutionApproval(): JSX.Element | null {
	return (
		<>
			<SchedulerExecutionApprovalForPresentation presentation="scheduler.run-now" />
			<SchedulerExecutionApprovalForPresentation presentation="scheduler.abort" />
		</>
	);
}

function SchedulerExecutionApprovalForPresentation({
	presentation,
}: {
	presentation: "scheduler.run-now" | "scheduler.abort";
}): JSX.Element | null {
	const approval = useActionApproval(presentation);
	if (!approval) return null;
	return <SchedulerExecutionDialog approval={approval} />;
}

function SchedulerExecutionDialog({ approval }: { approval: ActiveActionApproval }): JSX.Element {
	const { t } = useTranslation("common");
	const { request, responding, error, approve, reject } = approval;
	const input = request.input as unknown as ExecutionTaskInput;
	const detail = input?.operation ? operationDetails[input.operation] : undefined;
	const ThemedSchedulerActionApprovalDialogView = useThemeComponent(
		"root.approval.schedulerActionView",
		SchedulerActionApprovalDialogView,
	);

	return (
		<ThemedSchedulerActionApprovalDialogView
			title={detail ? t(detail.titleKey) : t("schedulerApproval.executionTitle")}
			summary={request.summary}
			taskId={input?.taskId}
			rawInput={request.input}
			detail={
				detail
					? {
							label: t(detail.labelKey),
							icon: detail.icon,
							descriptionTitle: t("schedulerApproval.executionDescriptionTitle"),
							description: t(detail.descriptionKey),
							warning: detail.warningKey ? t(detail.warningKey) : undefined,
							destructive: detail.destructive,
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
