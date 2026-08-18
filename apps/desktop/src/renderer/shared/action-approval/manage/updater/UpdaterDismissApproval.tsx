import { type ActiveActionApproval, useActionApproval } from "../../useActionApproval";
import {
	ApprovalImpactCard,
	ApprovalRawFallback,
	ApprovalTargetCard,
} from "../ApprovalParts";
import { useManageApprovalFrame } from "../useManageApprovalShell";

interface Input { operation: "dismiss"; }

function parseInput(input: unknown): Input | null {
	if (typeof input !== "object" || input === null || Array.isArray(input)) return null;
	const r = input as Record<string, unknown>;
	if (r.operation !== "dismiss") return null;
	return { operation: "dismiss" };
}

export function UpdaterDismissApproval(): JSX.Element | null {
	const approval = useActionApproval("updater.dismiss");
	if (!approval) return null;
	return <UpdaterDismissApprovalContent key={approval.request.approvalId} approval={approval} />;
}

function UpdaterDismissApprovalContent({ approval }: { approval: ActiveActionApproval }): JSX.Element {
	const { Frame, t, frameLabels } = useManageApprovalFrame();
	const { request, responding, error, approve, reject } = approval;
	const input = parseInput(request.input);
	const icon = "icon-[mdi--close-circle-outline]";

	return (
		<Frame
			presentation="dialog"
			title={t("manageApproval.updater.ops.dismiss.title")}
			summary={t("manageApproval.updater.ops.dismiss.summary")}
			icon={icon}
			badge={t("manageApproval.updater.ops.dismiss.badge")}
			labels={frameLabels(request.permission, t("manageApproval.updater.ops.dismiss.confirm"))}
			responding={responding}
			countdown={approval.countdown.formatted}
			error={error}
			onReject={reject}
			onApprove={() => approve()}
			canApprove={Boolean(input)}
		>
			{input ? (
				<>
					<ApprovalTargetCard icon="icon-[mdi--close-circle-outline]" title={t("manageApproval.updater.ops.dismiss.badge")} subtitle={t("manageApproval.updater.target")} />
					<ApprovalImpactCard
						icon={icon}
						title={t("manageApproval.afterActionTitle")}
						description={t("manageApproval.updater.ops.dismiss.impact")}
						
					/>
					
				</>
			) : (
				<ApprovalRawFallback input={request.input} />
			)}
		</Frame>
	);
}
