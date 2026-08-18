import { type ActiveActionApproval, useActionApproval } from "../../useActionApproval";
import {
	ApprovalImpactCard,
	ApprovalRawFallback,
	ApprovalTargetCard,
} from "../ApprovalParts";
import { useManageApprovalFrame } from "../useManageApprovalShell";

interface Input { operation: "scan-now"; }

function parseInput(input: unknown): Input | null {
	if (typeof input !== "object" || input === null || Array.isArray(input)) return null;
	const r = input as Record<string, unknown>;
	if (r.operation !== "scan-now") return null;
	return { operation: "scan-now" };
}

export function KnowledgeScanNowApproval(): JSX.Element | null {
	const approval = useActionApproval("knowledge.scan-now");
	if (!approval) return null;
	return <KnowledgeScanNowApprovalContent key={approval.request.approvalId} approval={approval} />;
}

function KnowledgeScanNowApprovalContent({ approval }: { approval: ActiveActionApproval }): JSX.Element {
	const { Frame, t, frameLabels } = useManageApprovalFrame();
	const { request, responding, error, approve, reject } = approval;
	const input = parseInput(request.input);
	const icon = "icon-[mdi--magnify-scan]";

	return (
		<Frame
			presentation="dialog"
			title={t("manageApproval.knowledge.ops.scan-now.title")}
			summary={t("manageApproval.knowledge.ops.scan-now.summary")}
			icon={icon}
			badge={t("manageApproval.knowledge.ops.scan-now.badge")}
			labels={frameLabels(request.permission, t("manageApproval.knowledge.ops.scan-now.confirm"))}
			responding={responding}
			countdown={approval.countdown.formatted}
			error={error}
			onReject={reject}
			onApprove={() => approve()}
			canApprove={Boolean(input)}
		>
			{input ? (
				<>
					<ApprovalTargetCard icon="icon-[mdi--magnify-scan]" title={t("manageApproval.knowledge.ops.scan-now.badge")} subtitle={t("manageApproval.knowledge.globalAction")} />
					<ApprovalImpactCard
						icon={icon}
						title={t("manageApproval.afterActionTitle")}
						description={t("manageApproval.knowledge.ops.scan-now.impact")}
						
					/>
					
				</>
			) : (
				<ApprovalRawFallback input={request.input} />
			)}
		</Frame>
	);
}
