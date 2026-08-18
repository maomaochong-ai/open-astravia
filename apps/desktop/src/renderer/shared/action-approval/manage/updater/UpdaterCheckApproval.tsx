import { type ActiveActionApproval, useActionApproval } from "../../useActionApproval";
import {
	ApprovalImpactCard,
	ApprovalRawFallback,
	ApprovalTargetCard,
} from "../ApprovalParts";
import { useManageApprovalFrame } from "../useManageApprovalShell";

interface Input { operation: "check"; }

function parseInput(input: unknown): Input | null {
	if (typeof input !== "object" || input === null || Array.isArray(input)) return null;
	const r = input as Record<string, unknown>;
	if (r.operation !== "check") return null;
	return { operation: "check" };
}

export function UpdaterCheckApproval(): JSX.Element | null {
	const approval = useActionApproval("updater.check");
	if (!approval) return null;
	return <UpdaterCheckApprovalContent key={approval.request.approvalId} approval={approval} />;
}

function UpdaterCheckApprovalContent({ approval }: { approval: ActiveActionApproval }): JSX.Element {
	const { Frame, t, frameLabels } = useManageApprovalFrame();
	const { request, responding, error, approve, reject } = approval;
	const input = parseInput(request.input);
	const icon = "icon-[mdi--cloud-search-outline]";

	return (
		<Frame
			presentation="dialog"
			title={t("manageApproval.updater.ops.check.title")}
			summary={t("manageApproval.updater.ops.check.summary")}
			icon={icon}
			badge={t("manageApproval.updater.ops.check.badge")}
			labels={frameLabels(request.permission, t("manageApproval.updater.ops.check.confirm"))}
			responding={responding}
			countdown={approval.countdown.formatted}
			error={error}
			onReject={reject}
			onApprove={() => approve()}
			canApprove={Boolean(input)}
		>
			{input ? (
				<>
					<ApprovalTargetCard icon="icon-[mdi--cloud-search-outline]" title={t("manageApproval.updater.ops.check.badge")} subtitle={t("manageApproval.updater.target")} />
					<ApprovalImpactCard
						icon={icon}
						title={t("manageApproval.afterActionTitle")}
						description={t("manageApproval.updater.ops.check.impact")}
						
					/>
					
				</>
			) : (
				<ApprovalRawFallback input={request.input} />
			)}
		</Frame>
	);
}
