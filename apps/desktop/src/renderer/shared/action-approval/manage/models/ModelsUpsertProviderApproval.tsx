import type { DesktopActionJsonValue } from "@preload/api.js";
import { useEffect, useState } from "react";
import { Input } from "../../../components/ui/input";
import { type ActiveActionApproval, useActionApproval } from "../../useActionApproval";
import {
	ApprovalFormField,
	ApprovalImpactCard,
	ApprovalRawFallback,
	ApprovalTargetCard,
} from "../ApprovalParts";
import { useManageApprovalFrame } from "../useManageApprovalShell";

interface Input {
	operation: "upsert-provider";
	provider: string;
	data?: {
		baseUrl?: string;
		apiKey?: string;
		api?: string;
		displayName?: string;
		models?: unknown[];
	};
	approvalUi?: string;
}

function parseInput(input: unknown): Input | null {
	if (typeof input !== "object" || input === null || Array.isArray(input)) return null;
	const r = input as Record<string, unknown>;
	if (r.operation !== "upsert-provider" || typeof r.provider !== "string") return null;
	return r as unknown as Input;
}


/** Model marker for inventory thin/container-with-view classification. */
function useModelsUpsertProviderApprovalModel(approval: ActiveActionApproval): ActiveActionApproval {
	return approval;
}

export function ModelsUpsertProviderApproval(): JSX.Element | null {
	const approval = useActionApproval("models.upsert-provider");
	if (!approval) return null;
	return <Content key={approval.request.approvalId} approval={approval} />;
}

function Content({ approval }: { approval: ActiveActionApproval }): JSX.Element {
	const { ManageActionApprovalFrame, t, frameLabels } = useManageApprovalFrame();
	const _approvalModel = useModelsUpsertProviderApprovalModel(approval);
	void _approvalModel;
	const { request, responding, error, approve, reject } = approval;
	const input = parseInput(request.input);
	const [form, setForm] = useState({
		baseUrl: input?.data?.baseUrl ?? "",
		apiKey: input?.data?.apiKey ?? "",
		api: input?.data?.api ?? "",
		displayName: input?.data?.displayName ?? "",
	});
	const [hint, setHint] = useState<string | null>(null);

	useEffect(() => {
		if (!input?.provider) return;
		let cancelled = false;
		void window.vetta.models.get().then((config) => {
			if (cancelled) return;
			const existing = config.providers[input.provider];
			if (!existing) {
				setHint(t("manageApproval.models.createProviderHint"));
				return;
			}
			setHint(t("manageApproval.models.updateProviderHint"));
			setForm((prev) => ({
				baseUrl: prev.baseUrl || existing.baseUrl || "",
				apiKey: prev.apiKey || existing.apiKey || "",
				api: prev.api || existing.api || "",
				displayName: prev.displayName || existing.displayName || "",
			}));
		}).catch(() => undefined);
		return () => { cancelled = true; };
	}, [input?.provider, t]);

	const onApprove = (): void => {
		if (!input) { approve(); return; }
		const data: Record<string, DesktopActionJsonValue> = {
			...(input.data as Record<string, DesktopActionJsonValue> | undefined),
		};
		if (form.baseUrl.trim()) data.baseUrl = form.baseUrl.trim();
		if (form.apiKey) data.apiKey = form.apiKey;
		if (form.api.trim()) data.api = form.api.trim();
		if (form.displayName.trim()) data.displayName = form.displayName.trim();
		approve({
			operation: "upsert-provider",
			provider: input.provider,
			data,
			approvalUi: input.approvalUi ?? "models.upsert-provider",
		});
	};

	return (
		<ManageActionApprovalFrame
			presentation="drawer"
			title={t("manageApproval.models.ops.upsert-provider.title")}
			summary={t("manageApproval.models.ops.upsert-provider.summary")}
			icon="icon-[mdi--server-plus-outline]"
			badge={t("manageApproval.models.ops.upsert-provider.badge")}
			labels={frameLabels(request.permission, t("manageApproval.models.ops.upsert-provider.confirm"))}
			responding={responding}
			countdown={approval.countdown.formatted}
			error={error}
			onReject={reject}
			onApprove={onApprove}
			canApprove={Boolean(input)}
		>
			{input ? (
				<>
					<ApprovalTargetCard
						icon="icon-[mdi--cloud-outline]"
						title={input.provider}
						subtitle={t("manageApproval.fields.provider")}
						badge={hint ?? undefined}
					/>
					<ApprovalFormField id="models-display-name" label={t("manageApproval.fields.displayName")}>
						<Input id="models-display-name" value={form.displayName} onChange={(e) => setForm((p) => ({ ...p, displayName: e.target.value }))} />
					</ApprovalFormField>
					<ApprovalFormField id="models-base-url" label={t("manageApproval.fields.baseUrl")}>
						<Input id="models-base-url" value={form.baseUrl} onChange={(e) => setForm((p) => ({ ...p, baseUrl: e.target.value }))} />
					</ApprovalFormField>
					<ApprovalFormField id="models-api" label={t("manageApproval.fields.api")}>
						<Input id="models-api" value={form.api} onChange={(e) => setForm((p) => ({ ...p, api: e.target.value }))} />
					</ApprovalFormField>
					<ApprovalFormField id="models-api-key" label={t("manageApproval.fields.apiKey")}>
						<Input id="models-api-key" type="password" value={form.apiKey} placeholder={t("manageApproval.secretPlaceholder")} onChange={(e) => setForm((p) => ({ ...p, apiKey: e.target.value }))} />
					</ApprovalFormField>
					{input.data?.models !== undefined && (
						<ApprovalTargetCard
							icon="icon-[mdi--format-list-bulleted]"
							title={t("manageApproval.fields.models")}
							subtitle={t("manageApproval.models.modelsCount", { count: Array.isArray(input.data.models) ? input.data.models.length : 0 })}
						/>
					)}
					<ApprovalImpactCard
						icon="icon-[mdi--server-plus-outline]"
						title={t("manageApproval.afterActionTitle")}
						description={t("manageApproval.models.ops.upsert-provider.impact")}
					/>
				</>
			) : (
				<ApprovalRawFallback input={request.input} />
			)}
		</ManageActionApprovalFrame>
	);
}
