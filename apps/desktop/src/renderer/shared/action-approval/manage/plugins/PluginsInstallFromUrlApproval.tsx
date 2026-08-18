import { useState } from "react";
import { Input } from "../../../components/ui/input";
import { type ActiveActionApproval, useActionApproval } from "../../useActionApproval";
import { ApprovalFormField, ApprovalImpactCard, ApprovalRawFallback } from "../ApprovalParts";
import { useManageApprovalFrame } from "../useManageApprovalShell";
interface InputData { operation: "install-from-url"; url: string; approvalUi?: string; }
function parseInput(input: unknown): InputData | null {
	if (typeof input !== "object" || input === null || Array.isArray(input)) return null;
	const r = input as Record<string, unknown>;
	if (r.operation !== "install-from-url" || typeof r.url !== "string") return null;
	return r as unknown as InputData;
}
export function PluginsInstallFromUrlApproval(): JSX.Element | null {
	const approval = useActionApproval("plugins.install-from-url");
	if (!approval) return null;
	return <Content key={approval.request.approvalId} approval={approval} />;
}
function Content({ approval }: { approval: ActiveActionApproval }): JSX.Element {
	const { Frame, t, frameLabels } = useManageApprovalFrame();
	const { request, responding, error, approve, reject } = approval;
	const input = parseInput(request.input);
	const [url, setUrl] = useState(input?.url ?? "");
	return (
		<Frame presentation="drawer" title={t("manageApproval.plugins.ops.install-from-url.title")} summary={t("manageApproval.plugins.ops.install-from-url.summary")} icon="icon-[mdi--download-outline]" badge={t("manageApproval.plugins.ops.install-from-url.badge")} labels={frameLabels(request.permission, t("manageApproval.plugins.ops.install-from-url.confirm"))} responding={responding} countdown={approval.countdown.formatted} error={error} onReject={reject} onApprove={() => input ? approve({ operation: "install-from-url", url: url.trim(), approvalUi: input.approvalUi ?? "plugins.install-from-url" }) : approve()} canApprove={url.trim().length > 0}>
			{input ? (<><ApprovalFormField id="plugin-url" label={t("manageApproval.fields.url")}><Input id="plugin-url" value={url} onChange={(e) => setUrl(e.target.value)} /></ApprovalFormField><ApprovalImpactCard icon="icon-[mdi--download-outline]" title={t("manageApproval.afterActionTitle")} description={t("manageApproval.plugins.ops.install-from-url.impact")} /></>) : (<ApprovalRawFallback input={request.input} />)}
		</Frame>
	);
}
