import { type ActiveActionApproval, useActionApproval } from "../../useActionApproval";
import {
	ApprovalImpactCard,
	ApprovalRawFallback,
	ApprovalTargetCard,
} from "../ApprovalParts";
import { useManageApprovalFrame } from "../useManageApprovalShell";

interface Input { operation: "add-files"; kbId: string; paths: string[]; move?: boolean; }

function parseInput(input: unknown): Input | null {
	if (typeof input !== "object" || input === null || Array.isArray(input)) return null;
	const r = input as Record<string, unknown>;
	if (r.operation !== "add-files" || typeof r.kbId !== "string" || !Array.isArray(r.paths)) return null;
	return r as unknown as Input;
}

export function KnowledgeAddFilesApproval(): JSX.Element | null {
	const approval = useActionApproval("knowledge.add-files");
	if (!approval) return null;
	return <KnowledgeAddFilesApprovalContent key={approval.request.approvalId} approval={approval} />;
}

function KnowledgeAddFilesApprovalContent({ approval }: { approval: ActiveActionApproval }): JSX.Element {
	const { Frame, t, frameLabels } = useManageApprovalFrame();
	const { request, responding, error, approve, reject } = approval;
	const input = parseInput(request.input);
	const icon = "icon-[mdi--file-plus-outline]";

	return (
		<Frame
			presentation="dialog"
			title={t("manageApproval.knowledge.ops.add-files.title")}
			summary={t("manageApproval.knowledge.ops.add-files.summary")}
			icon={icon}
			badge={t("manageApproval.knowledge.ops.add-files.badge")}
			labels={frameLabels(request.permission, t("manageApproval.knowledge.ops.add-files.confirm"))}
			responding={responding}
			countdown={approval.countdown.formatted}
			error={error}
			onReject={reject}
			onApprove={() => approve()}
			canApprove={Boolean(input)}
		>
			{input ? (
				<>
					<ApprovalTargetCard icon="icon-[mdi--bookshelf]" title={input.kbId} subtitle={t("manageApproval.fields.kbId")} rows={[
						{ label: t("manageApproval.fields.paths"), value: input.paths.join("\n"), mono: true },
						{ label: t("manageApproval.fields.move"), value: input.move ? t("manageApproval.yes") : t("manageApproval.no") },
					]} />
					<ApprovalImpactCard
						icon={icon}
						title={t("manageApproval.afterActionTitle")}
						description={t("manageApproval.knowledge.ops.add-files.impact")}
						
					/>
					
				</>
			) : (
				<ApprovalRawFallback input={request.input} />
			)}
		</Frame>
	);
}
