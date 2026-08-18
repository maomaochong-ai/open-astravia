import type { WebhookEndpointPublic } from "@preload/api.js";
import { useEffect, useState } from "react";
import { Input } from "../../../components/ui/input";
import { type ActiveActionApproval, useActionApproval } from "../../useActionApproval";
import { ApprovalFormField, ApprovalImpactCard, ApprovalRawFallback, ApprovalTargetCard } from "../ApprovalParts";
import { useManageApprovalFrame } from "../useManageApprovalShell";

interface InputData {
	operation: "update";
	id: string;
	data?: { name?: string; enabled?: boolean; webhookUrl?: string; signSecret?: string };
	approvalUi?: string;
}

function parseInput(input: unknown): InputData | null {
	if (typeof input !== "object" || input === null || Array.isArray(input)) return null;
	const r = input as Record<string, unknown>;
	if (r.operation !== "update" || typeof r.id !== "string") return null;
	return r as unknown as InputData;
}


/** Model marker for inventory thin/container-with-view classification. */
function useWebhookUpdateApprovalModel(approval: ActiveActionApproval): ActiveActionApproval {
	return approval;
}

export function WebhookUpdateApproval(): JSX.Element | null {
	const approval = useActionApproval("webhook.update");
	if (!approval) return null;
	return <Content key={approval.request.approvalId} approval={approval} />;
}

function Content({ approval }: { approval: ActiveActionApproval }): JSX.Element {
	const { ManageActionApprovalFrame, t, frameLabels } = useManageApprovalFrame();
	const _approvalModel = useWebhookUpdateApprovalModel(approval);
	void _approvalModel;
	const { request, responding, error, approve, reject } = approval;
	const input = parseInput(request.input);
	const [name, setName] = useState(input?.data?.name ?? "");
	const [webhookUrl, setWebhookUrl] = useState(input?.data?.webhookUrl ?? "");
	const [signSecret, setSignSecret] = useState(input?.data?.signSecret ?? "");
	const [endpoint, setEndpoint] = useState<WebhookEndpointPublic | null>(null);
	const [loadError, setLoadError] = useState<string | null>(null);

	useEffect(() => {
		if (!input?.id) return;
		let cancelled = false;
		void window.vetta.webhook.list().then((items) => {
			if (cancelled) return;
			const matched = items.find((item) => item.id === input.id) ?? null;
			setEndpoint(matched);
			if (!matched) setLoadError(t("manageApproval.webhook.notFound"));
			if (matched) setName((prev) => prev || matched.name);
		}).catch(() => {
			if (!cancelled) setLoadError(t("manageApproval.webhook.loadFailed"));
		});
		return () => { cancelled = true; };
	}, [input?.id, t]);

	return (
		<ManageActionApprovalFrame
			presentation="drawer"
			title={t("manageApproval.webhook.ops.update.title")}
			summary={t("manageApproval.webhook.ops.update.summary")}
			icon="icon-[mdi--webhook]"
			badge={t("manageApproval.webhook.ops.update.badge")}
			labels={frameLabels(request.permission, t("manageApproval.webhook.ops.update.confirm"))}
			responding={responding}
			countdown={approval.countdown.formatted}
			error={error ?? loadError}
			onReject={reject}
			onApprove={() => {
				if (!input) { approve(); return; }
				const data: Record<string, string | boolean> = { ...(input.data ?? {}) };
				if (name.trim()) data.name = name.trim();
				if (webhookUrl.trim()) data.webhookUrl = webhookUrl.trim();
				if (signSecret) data.signSecret = signSecret;
				approve({ operation: "update", id: input.id, data, approvalUi: input.approvalUi ?? "webhook.update" });
			}}
			canApprove={Boolean(input?.id) && !loadError}
		>
			{input ? (
				<>
					<ApprovalTargetCard
						icon="icon-[mdi--webhook]"
						title={endpoint?.name ?? input.id}
						subtitle={endpoint?.urlMask ?? input.id}
						badge={endpoint?.kind}
					/>
					<ApprovalFormField id="webhook-update-name" label={t("manageApproval.fields.name")}>
						<Input id="webhook-update-name" value={name} onChange={(e) => setName(e.target.value)} />
					</ApprovalFormField>
					<ApprovalFormField id="webhook-update-url" label={t("manageApproval.fields.webhookUrl")}>
						<Input id="webhook-update-url" value={webhookUrl} onChange={(e) => setWebhookUrl(e.target.value)} />
					</ApprovalFormField>
					<ApprovalFormField id="webhook-update-secret" label={t("manageApproval.fields.signSecret")}>
						<Input id="webhook-update-secret" type="password" value={signSecret} placeholder={t("manageApproval.secretPlaceholder")} onChange={(e) => setSignSecret(e.target.value)} />
					</ApprovalFormField>
					<ApprovalImpactCard icon="icon-[mdi--webhook]" title={t("manageApproval.afterActionTitle")} description={t("manageApproval.webhook.ops.update.impact")} />
				</>
			) : (
				<ApprovalRawFallback input={request.input} />
			)}
		</ManageActionApprovalFrame>
	);
}
