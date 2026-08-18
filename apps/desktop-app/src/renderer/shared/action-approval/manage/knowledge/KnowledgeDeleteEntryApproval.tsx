import { type ActiveActionApproval, useActionApproval } from "../../useActionApproval";
import {
	ApprovalImpactCard,
	ApprovalRawFallback,
	ApprovalTargetCard,
	ApprovalWarningCard,
} from "../ApprovalParts";
import { useManageApprovalFrame } from "../useManageApprovalShell";

interface Input { operation: "delete-entry"; kbId: string; relPath: string; }

function parseInput(input: unknown): Input | null {
	if (typeof input !== "object" || input === null || Array.isArray(input)) return null;
	const r = input as Record<string, unknown>;
	if (r.operation !== "delete-entry" || typeof r.kbId !== "string" || typeof r.relPath !== "string") return null;
	return r as unknown as Input;
}

export function KnowledgeDeleteEntryApproval(): JSX.Element | null {
	const approval = useActionApproval("knowledge.delete-entry");
	if (!approval) return null;
	return <KnowledgeDeleteEntryApprovalContent key={approval.request.approvalId} approval={approval} />;
}

function KnowledgeDeleteEntryApprovalContent({ approval }: { approval: ActiveActionApproval }): JSX.Element {
	const { Frame, t, frameLabels } = useManageApprovalFrame();
	const { request, responding, error, approve, reject } = approval;
	const input = parseInput(request.input);
	const icon = "icon-[mdi--file-remove-outline]";

	return (
		<Frame
			presentation="dialog"
			title={t("manageApproval.knowledge.ops.delete-entry.title")}
			summary={t("manageApproval.knowledge.ops.delete-entry.summary")}
			icon={icon}
			badge={t("manageApproval.knowledge.ops.delete-entry.badge")}
			destructive
			labels={frameLabels(request.permission, t("manageApproval.knowledge.ops.delete-entry.confirm"))}
			responding={responding}
			countdown={approval.countdown.formatted}
			error={error}
			onReject={reject}
			onApprove={() => approve()}
			canApprove={Boolean(input)}
		>
			{input ? (
				<>
					<ApprovalTargetCard icon="icon-[mdi--file-outline]" title={input.relPath} subtitle={input.kbId} />
					<ApprovalImpactCard
						icon={icon}
						title={t("manageApproval.afterActionTitle")}
						description={t("manageApproval.knowledge.ops.delete-entry.impact")}
						destructive
					/>
					<ApprovalWarningCard>{t("manageApproval.knowledge.ops.delete-entry.warning")}</ApprovalWarningCard>
				</>
			) : (
				<ApprovalRawFallback input={request.input} />
			)}
		</Frame>
	);
}
