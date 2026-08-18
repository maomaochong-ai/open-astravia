import { type ActiveActionApproval, useActionApproval } from "../../useActionApproval";
import {
	ApprovalImpactCard,
	ApprovalRawFallback,
	ApprovalTargetCard,
	ApprovalWarningCard,
} from "../ApprovalParts";
import { useManageApprovalFrame } from "../useManageApprovalShell";

interface Input { operation: "delete"; name: string; }

function parseInput(input: unknown): Input | null {
	if (typeof input !== "object" || input === null || Array.isArray(input)) return null;
	const r = input as Record<string, unknown>;
	if (r.operation !== "delete" || typeof r.name !== "string") return null;
	return { operation: "delete", name: r.name };
}

export function KnowledgeDeleteApproval(): JSX.Element | null {
	const approval = useActionApproval("knowledge.delete");
	if (!approval) return null;
	return <KnowledgeDeleteApprovalContent key={approval.request.approvalId} approval={approval} />;
}

function KnowledgeDeleteApprovalContent({ approval }: { approval: ActiveActionApproval }): JSX.Element {
	const { Frame, t, frameLabels } = useManageApprovalFrame();
	const { request, responding, error, approve, reject } = approval;
	const input = parseInput(request.input);
	const icon = "icon-[mdi--book-remove-outline]";

	return (
		<Frame
			presentation="dialog"
			title={t("manageApproval.knowledge.ops.delete.title")}
			summary={t("manageApproval.knowledge.ops.delete.summary")}
			icon={icon}
			badge={t("manageApproval.knowledge.ops.delete.badge")}
			destructive
			labels={frameLabels(request.permission, t("manageApproval.knowledge.ops.delete.confirm"))}
			responding={responding}
			countdown={approval.countdown.formatted}
			error={error}
			onReject={reject}
			onApprove={() => approve()}
			canApprove={Boolean(input)}
		>
			{input ? (
				<>
					<ApprovalTargetCard icon="icon-[mdi--bookshelf]" title={input.name} />
					<ApprovalImpactCard
						icon={icon}
						title={t("manageApproval.afterActionTitle")}
						description={t("manageApproval.knowledge.ops.delete.impact")}
						destructive
					/>
					<ApprovalWarningCard>{t("manageApproval.knowledge.ops.delete.warning")}</ApprovalWarningCard>
				</>
			) : (
				<ApprovalRawFallback input={request.input} />
			)}
		</Frame>
	);
}
