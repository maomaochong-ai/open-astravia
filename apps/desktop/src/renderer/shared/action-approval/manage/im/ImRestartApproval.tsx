import { type ActiveActionApproval, useActionApproval } from "../../useActionApproval";
import {
	ApprovalImpactCard,
	ApprovalRawFallback,
	ApprovalTargetCard,
} from "../ApprovalParts";
import { useManageApprovalFrame } from "../useManageApprovalShell";

interface Input { operation: "restart"; }

function parseInput(input: unknown): Input | null {
	if (typeof input !== "object" || input === null || Array.isArray(input)) return null;
	const r = input as Record<string, unknown>;
	if (r.operation !== "restart") return null;
	return { operation: "restart" };
}

export function ImRestartApproval(): JSX.Element | null {
	const approval = useActionApproval("im.restart");
	if (!approval) return null;
	return <ImRestartApprovalContent key={approval.request.approvalId} approval={approval} />;
}

function ImRestartApprovalContent({ approval }: { approval: ActiveActionApproval }): JSX.Element {
	const { Frame, t, frameLabels } = useManageApprovalFrame();
	const { request, responding, error, approve, reject } = approval;
	const input = parseInput(request.input);
	const icon = "icon-[mdi--restart]";

	return (
		<Frame
			presentation="dialog"
			title={t("manageApproval.im.ops.restart.title")}
			summary={t("manageApproval.im.ops.restart.summary")}
			icon={icon}
			badge={t("manageApproval.im.ops.restart.badge")}
			labels={frameLabels(request.permission, t("manageApproval.im.ops.restart.confirm"))}
			responding={responding}
			countdown={approval.countdown.formatted}
			error={error}
			onReject={reject}
			onApprove={() => approve()}
			canApprove={Boolean(input)}
		>
			{input ? (
				<>
					<ApprovalTargetCard icon="icon-[mdi--restart]" title={t("manageApproval.im.restartTarget")} />
					<ApprovalImpactCard
						icon={icon}
						title={t("manageApproval.afterActionTitle")}
						description={t("manageApproval.im.ops.restart.impact")}
						
					/>
					
				</>
			) : (
				<ApprovalRawFallback input={request.input} />
			)}
		</Frame>
	);
}
