import { useState } from "react";
import { Input } from "../../../components/ui/input";
import { type ActiveActionApproval, useActionApproval } from "../../useActionApproval";
import { ApprovalFormField, ApprovalImpactCard, ApprovalRawFallback, ApprovalTargetCard } from "../ApprovalParts";
import { useManageApprovalFrame } from "../useManageApprovalShell";

interface InputData {
	operation: "create";
	kind: "feishu" | "dingtalk";
	name?: string;
	webhookUrl: string;
	signSecret?: string;
	enabled?: boolean;
	approvalUi?: string;
}

function parseInput(input: unknown): InputData | null {
	if (typeof input !== "object" || input === null || Array.isArray(input)) return null;
	const r = input as Record<string, unknown>;
	if (r.operation !== "create" || typeof r.webhookUrl !== "string") return null;
	return r as unknown as InputData;
}

export function WebhookCreateApproval(): JSX.Element | null {
	const approval = useActionApproval("webhook.create");
	if (!approval) return null;
	return <Content key={approval.request.approvalId} approval={approval} />;
}

function Content({ approval }: { approval: ActiveActionApproval }): JSX.Element {
	const { Frame, t, frameLabels } = useManageApprovalFrame();
	const { request, responding, error, approve, reject } = approval;
	const input = parseInput(request.input);
	const [name, setName] = useState(input?.name ?? "");
	const [webhookUrl, setWebhookUrl] = useState(input?.webhookUrl ?? "");
	const [signSecret, setSignSecret] = useState(input?.signSecret ?? "");

	return (
		<Frame
			presentation="drawer"
			title={t("manageApproval.webhook.ops.create.title")}
			summary={t("manageApproval.webhook.ops.create.summary")}
			icon="icon-[mdi--webhook]"
			badge={t("manageApproval.webhook.ops.create.badge")}
			labels={frameLabels(request.permission, t("manageApproval.webhook.ops.create.confirm"))}
			responding={responding}
			countdown={approval.countdown.formatted}
			error={error}
			onReject={reject}
			onApprove={() => {
				if (!input) { approve(); return; }
				approve({
					operation: "create",
					kind: input.kind ?? "feishu",
					webhookUrl: webhookUrl.trim(),
					approvalUi: input.approvalUi ?? "webhook.create",
					...(name.trim() ? { name: name.trim() } : {}),
					...(signSecret ? { signSecret } : {}),
					...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
				});
			}}
			canApprove={webhookUrl.trim().length > 0}
		>
			{input ? (
				<>
					<ApprovalTargetCard
						icon="icon-[mdi--webhook]"
						title={input.kind === "dingtalk" ? t("manageApproval.webhook.dingtalk") : t("manageApproval.webhook.feishu")}
						subtitle={t("manageApproval.fields.kind")}
					/>
					<ApprovalFormField id="webhook-create-name" label={t("manageApproval.fields.name")}>
						<Input id="webhook-create-name" value={name} onChange={(e) => setName(e.target.value)} />
					</ApprovalFormField>
					<ApprovalFormField id="webhook-create-url" label={t("manageApproval.fields.webhookUrl")}>
						<Input id="webhook-create-url" value={webhookUrl} onChange={(e) => setWebhookUrl(e.target.value)} />
					</ApprovalFormField>
					<ApprovalFormField id="webhook-create-secret" label={t("manageApproval.fields.signSecret")}>
						<Input id="webhook-create-secret" type="password" value={signSecret} placeholder={t("manageApproval.secretPlaceholder")} onChange={(e) => setSignSecret(e.target.value)} />
					</ApprovalFormField>
					<ApprovalImpactCard icon="icon-[mdi--webhook]" title={t("manageApproval.afterActionTitle")} description={t("manageApproval.webhook.ops.create.impact")} />
				</>
			) : (
				<ApprovalRawFallback input={request.input} />
			)}
		</Frame>
	);
}
