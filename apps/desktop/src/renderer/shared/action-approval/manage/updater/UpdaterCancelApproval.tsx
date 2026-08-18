import { type ActiveActionApproval, useActionApproval } from "../../useActionApproval";
import {
	ApprovalImpactCard,
	ApprovalRawFallback,
	ApprovalTargetCard,
} from "../ApprovalParts";
import { useManageApprovalFrame } from "../useManageApprovalShell";

interface Input { operation: "cancel"; }

function parseInput(input: unknown): Input | null {
	if (typeof input !== "object" || input === null || Array.isArray(input)) return null;
	const r = input as Record<string, unknown>;
	if (r.operation !== "cancel") return null;
	return { operation: "cancel" };
}

export function UpdaterCancelApproval(): JSX.Element | null {
	const approval = useActionApproval("updater.cancel");
	if (!approval) return null;
	return <UpdaterCancelApprovalContent key={approval.request.approvalId} approval={approval} />;
}

function UpdaterCancelApprovalContent({ approval }: { approval: ActiveActionApproval }): JSX.Element {
	const { Frame, t, frameLabels } = useManageApprovalFrame();
	const { request, responding, error, approve, reject } = approval;
	const input = parseInput(request.input);
	const icon = "icon-[mdi--cancel]";

	return (
		<Frame
			presentation="dialog"
			title={t("manageApproval.updater.ops.cancel.title")}
			summary={t("manageApproval.updater.ops.cancel.summary")}
			icon={icon}
			badge={t("manageApproval.updater.ops.cancel.badge")}
			destructive
			labels={frameLabels(request.permission, t("manageApproval.updater.ops.cancel.confirm"))}
			responding={responding}
			countdown={approval.countdown.formatted}
			error={error}
			onReject={reject}
			onApprove={() => approve()}
			canApprove={Boolean(input)}
		>
			{input ? (
				<>
					<ApprovalTargetCard icon="icon-[mdi--cancel]" title={t("manageApproval.updater.ops.cancel.badge")} subtitle={t("manageApproval.updater.target")} />
					<ApprovalImpactCard
						icon={icon}
						title={t("manageApproval.afterActionTitle")}
						description={t("manageApproval.updater.ops.cancel.impact")}
						destructive
					/>
					
				</>
			) : (
				<ApprovalRawFallback input={request.input} />
			)}
		</Frame>
	);
}
