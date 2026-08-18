import { useState } from "react";
import { Input } from "../../../components/ui/input";
import { type ActiveActionApproval, useActionApproval } from "../../useActionApproval";
import { ApprovalFormField, ApprovalImpactCard, ApprovalRawFallback, ApprovalTargetCard } from "../ApprovalParts";
import { useManageApprovalFrame } from "../useManageApprovalShell";
interface InputData { operation: "rename"; name: string; newName: string; approvalUi?: string; }
function parseInput(input: unknown): InputData | null {
	if (typeof input !== "object" || input === null || Array.isArray(input)) return null;
	const r = input as Record<string, unknown>;
	if (r.operation !== "rename" || typeof r.name !== "string" || typeof r.newName !== "string") return null;
	return r as unknown as InputData;
}
export function KnowledgeRenameApproval(): JSX.Element | null {
	const approval = useActionApproval("knowledge.rename");
	if (!approval) return null;
	return <Content key={approval.request.approvalId} approval={approval} />;
}
function Content({ approval }: { approval: ActiveActionApproval }): JSX.Element {
	const { Frame, t, frameLabels } = useManageApprovalFrame();
	const { request, responding, error, approve, reject } = approval;
	const input = parseInput(request.input);
	const [newName, setNewName] = useState(input?.newName ?? "");
	return (
		<Frame presentation="drawer" title={t("manageApproval.knowledge.ops.rename.title")} summary={t("manageApproval.knowledge.ops.rename.summary")} icon="icon-[mdi--book-edit-outline]" badge={t("manageApproval.knowledge.ops.rename.badge")} labels={frameLabels(request.permission, t("manageApproval.knowledge.ops.rename.confirm"))} responding={responding} countdown={approval.countdown.formatted} error={error} onReject={reject} onApprove={() => input ? approve({ operation: "rename", name: input.name, newName: newName.trim(), approvalUi: input.approvalUi ?? "knowledge.rename" }) : approve()} canApprove={newName.trim().length > 0}>
			{input ? (<><ApprovalTargetCard icon="icon-[mdi--bookshelf]" title={input.name} /><ApprovalFormField id="kb-new-name" label={t("manageApproval.fields.newName")}><Input id="kb-new-name" value={newName} onChange={(e) => setNewName(e.target.value)} /></ApprovalFormField><ApprovalImpactCard icon="icon-[mdi--book-edit-outline]" title={t("manageApproval.afterActionTitle")} description={t("manageApproval.knowledge.ops.rename.impact")} /></>) : (<ApprovalRawFallback input={request.input} />)}
		</Frame>
	);
}
