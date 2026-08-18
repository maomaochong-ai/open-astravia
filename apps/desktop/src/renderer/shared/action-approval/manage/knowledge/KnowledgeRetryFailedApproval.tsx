import { type ActiveActionApproval, useActionApproval } from "../../useActionApproval";
import {
	ApprovalImpactCard,
	ApprovalRawFallback,
	ApprovalTargetCard,
} from "../ApprovalParts";
import { useManageApprovalFrame } from "../useManageApprovalShell";

interface Input { operation: "retry-failed"; }

function parseInput(input: unknown): Input | null {
	if (typeof input !== "object" || input === null || Array.isArray(input)) return null;
	const r = input as Record<string, unknown>;
	if (r.operation !== "retry-failed") return null;
	return { operation: "retry-failed" };
}

export function KnowledgeRetryFailedApproval(): JSX.Element | null {
	const approval = useActionApproval("knowledge.retry-failed");
	if (!approval) return null;
	return <KnowledgeRetryFailedApprovalContent key={approval.request.approvalId} approval={approval} />;
}

function KnowledgeRetryFailedApprovalContent({ approval }: { approval: ActiveActionApproval }): JSX.Element {
	const { Frame, t, frameLabels } = useManageApprovalFrame();
	const { request, responding, error, approve, reject } = approval;
	const input = parseInput(request.input);
	const icon = "icon-[mdi--restart]";

	return (
		<Frame
			presentation="dialog"
			title={t("manageApproval.knowledge.ops.retry-failed.title")}
			summary={t("manageApproval.knowledge.ops.retry-failed.summary")}
			icon={icon}
			badge={t("manageApproval.knowledge.ops.retry-failed.badge")}
			labels={frameLabels(request.permission, t("manageApproval.knowledge.ops.retry-failed.confirm"))}
			responding={responding}
			countdown={approval.countdown.formatted}
			error={error}
			onReject={reject}
			onApprove={() => approve()}
			canApprove={Boolean(input)}
		>
			{input ? (
				<>
					<ApprovalTargetCard icon="icon-[mdi--restart]" title={t("manageApproval.knowledge.ops.retry-failed.badge")} subtitle={t("manageApproval.knowledge.globalAction")} />
					<ApprovalImpactCard
						icon={icon}
						title={t("manageApproval.afterActionTitle")}
						description={t("manageApproval.knowledge.ops.retry-failed.impact")}
						
					/>
					
				</>
			) : (
				<ApprovalRawFallback input={request.input} />
			)}
		</Frame>
	);
}
