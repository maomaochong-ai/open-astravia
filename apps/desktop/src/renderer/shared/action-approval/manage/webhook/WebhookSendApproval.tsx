import type { WebhookEndpointPublic } from "@preload/api.js";
import { useEffect, useState } from "react";
import { Input } from "../../../components/ui/input";
import { Textarea } from "../../../components/ui/textarea";
import { type ActiveActionApproval, useActionApproval } from "../../useActionApproval";
import { ApprovalFormField, ApprovalImpactCard, ApprovalRawFallback, ApprovalTargetCard } from "../ApprovalParts";
import { useManageApprovalFrame } from "../useManageApprovalShell";
interface InputData { operation: "send"; id: string; text: string; title?: string; level?: "info" | "warn" | "error" | "success"; approvalUi?: string; }
function parseInput(input: unknown): InputData | null {
	if (typeof input !== "object" || input === null || Array.isArray(input)) return null;
	const r = input as Record<string, unknown>;
	if (r.operation !== "send" || typeof r.id !== "string" || typeof r.text !== "string") return null;
	return r as unknown as InputData;
}

/** Model marker for inventory thin/container-with-view classification. */
function useWebhookSendApprovalModel(approval: ActiveActionApproval): ActiveActionApproval {
	return approval;
}

export function WebhookSendApproval(): JSX.Element | null {
	const approval = useActionApproval("webhook.send");
	if (!approval) return null;
	return <Content key={approval.request.approvalId} approval={approval} />;
}
function Content({ approval }: { approval: ActiveActionApproval }): JSX.Element {
	const { ManageActionApprovalFrame, t, frameLabels } = useManageApprovalFrame();
	const _approvalModel = useWebhookSendApprovalModel(approval);
	void _approvalModel;
	const { request, responding, error, approve, reject } = approval;
	const input = parseInput(request.input);
	const [title, setTitle] = useState(input?.title ?? "");
	const [text, setText] = useState(input?.text ?? "");
	const [endpoint, setEndpoint] = useState<WebhookEndpointPublic | null>(null);
	useEffect(() => {
		if (!input?.id) return;
		let cancelled = false;
		void window.vetta.webhook.list().then((items) => {
			if (!cancelled) setEndpoint(items.find((item) => item.id === input.id) ?? null);
		}).catch(() => undefined);
		return () => { cancelled = true; };
	}, [input?.id]);
	return (
		<ManageActionApprovalFrame presentation="drawer" title={t("manageApproval.webhook.ops.send.title")} summary={t("manageApproval.webhook.ops.send.summary")} icon="icon-[mdi--send-outline]" badge={t("manageApproval.webhook.ops.send.badge")} labels={frameLabels(request.permission, t("manageApproval.webhook.ops.send.confirm"))} responding={responding} countdown={approval.countdown.formatted} error={error} onReject={reject} onApprove={() => {
			if (!input) { approve(); return; }
			approve({ operation: "send", id: input.id, text: text.trim(), approvalUi: input.approvalUi ?? "webhook.send", ...(title.trim() ? { title: title.trim() } : {}), ...(input.level ? { level: input.level } : {}) });
		}} canApprove={text.trim().length > 0 && Boolean(input?.id)}>
			{input ? (<><ApprovalTargetCard icon="icon-[mdi--webhook]" title={endpoint?.name ?? input.id} subtitle={endpoint?.urlMask ?? input.id} /><ApprovalFormField id="webhook-send-title" label={t("manageApproval.fields.title")}><Input id="webhook-send-title" value={title} onChange={(e) => setTitle(e.target.value)} /></ApprovalFormField><ApprovalFormField id="webhook-send-text" label={t("manageApproval.fields.text")}><Textarea id="webhook-send-text" value={text} onChange={(e) => setText(e.target.value)} className="min-h-28 resize-y" /></ApprovalFormField><ApprovalImpactCard icon="icon-[mdi--send-outline]" title={t("manageApproval.afterActionTitle")} description={t("manageApproval.webhook.ops.send.impact")} /></>) : (<ApprovalRawFallback input={request.input} />)}
		</ManageActionApprovalFrame>
	);
}
