import { useState } from "react";
import { Input } from "../../../components/ui/input";
import { type ActiveActionApproval, useActionApproval } from "../../useActionApproval";
import { ApprovalFormField, ApprovalImpactCard, ApprovalRawFallback } from "../ApprovalParts";
import { useManageApprovalFrame } from "../useManageApprovalShell";
interface InputData { operation: "create"; name: string; approvalUi?: string; }
function parseInput(input: unknown): InputData | null {
	if (typeof input !== "object" || input === null || Array.isArray(input)) return null;
	const r = input as Record<string, unknown>;
	if (r.operation !== "create" || typeof r.name !== "string") return null;
	return r as unknown as InputData;
}
export function KnowledgeCreateApproval(): JSX.Element | null {
	const approval = useActionApproval("knowledge.create");
	if (!approval) return null;
	return <Content key={approval.request.approvalId} approval={approval} />;
}
function Content({ approval }: { approval: ActiveActionApproval }): JSX.Element {
	const { Frame, t, frameLabels } = useManageApprovalFrame();
	const { request, responding, error, approve, reject } = approval;
	const input = parseInput(request.input);
	const [name, setName] = useState(input?.name ?? "");
	return (
		<Frame presentation="drawer" title={t("manageApproval.knowledge.ops.create.title")} summary={t("manageApproval.knowledge.ops.create.summary")} icon="icon-[mdi--book-plus-outline]" badge={t("manageApproval.knowledge.ops.create.badge")} labels={frameLabels(request.permission, t("manageApproval.knowledge.ops.create.confirm"))} responding={responding} countdown={approval.countdown.formatted} error={error} onReject={reject} onApprove={() => input ? approve({ operation: "create", name: name.trim(), approvalUi: input.approvalUi ?? "knowledge.create" }) : approve()} canApprove={name.trim().length > 0}>
			{input ? (<><ApprovalFormField id="kb-create-name" label={t("manageApproval.fields.name")}><Input id="kb-create-name" value={name} onChange={(e) => setName(e.target.value)} /></ApprovalFormField><ApprovalImpactCard icon="icon-[mdi--book-plus-outline]" title={t("manageApproval.afterActionTitle")} description={t("manageApproval.knowledge.ops.create.impact")} /></>) : (<ApprovalRawFallback input={request.input} />)}
		</Frame>
	);
}
