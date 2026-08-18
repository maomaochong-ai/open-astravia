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
	operation: "set-feishu-config";
	appId?: string;
	appSecret?: string;
	verificationToken?: string;
	encryptKey?: string;
	baseUrl?: string;
	enabled?: boolean;
	approvalUi?: string;
}

export function parseImSetFeishuConfigInput(input: unknown): Input | null {
	if (typeof input !== "object" || input === null || Array.isArray(input)) return null;
	const r = input as Record<string, unknown>;
	if (r.operation !== "set-feishu-config") return null;
	return {
		operation: "set-feishu-config",
		appId: typeof r.appId === "string" ? r.appId : undefined,
		appSecret: typeof r.appSecret === "string" ? r.appSecret : undefined,
		verificationToken: typeof r.verificationToken === "string" ? r.verificationToken : undefined,
		encryptKey: typeof r.encryptKey === "string" ? r.encryptKey : undefined,
		baseUrl: typeof r.baseUrl === "string" ? r.baseUrl : undefined,
		enabled: typeof r.enabled === "boolean" ? r.enabled : undefined,
		approvalUi: typeof r.approvalUi === "string" ? r.approvalUi : undefined,
	};
}

export function ImSetFeishuConfigApproval(): JSX.Element | null {
	const approval = useActionApproval("im.set-feishu-config");
	if (!approval) return null;
	return <Content key={approval.request.approvalId} approval={approval} />;
}

function Content({ approval }: { approval: ActiveActionApproval }): JSX.Element {
	const { Frame, t, frameLabels } = useManageApprovalFrame();
	const { request, responding, error, approve, reject } = approval;
	const parsed = parseImSetFeishuConfigInput(request.input);
	const [form, setForm] = useState({
		appId: parsed?.appId ?? "",
		appSecret: parsed?.appSecret ?? "",
		verificationToken: parsed?.verificationToken ?? "",
		encryptKey: parsed?.encryptKey ?? "",
		baseUrl: parsed?.baseUrl ?? "",
	});

	useEffect(() => {
		let cancelled = false;
		void window.vetta.im
			.getConfig()
			.then((config) => {
				if (cancelled) return;
				setForm((prev) => ({
					appId: prev.appId || config.feishu.appId || "",
					appSecret: prev.appSecret,
					verificationToken: prev.verificationToken,
					encryptKey: prev.encryptKey,
					baseUrl: prev.baseUrl || config.feishu.baseUrl || "",
				}));
			})
			.catch(() => undefined);
		return () => {
			cancelled = true;
		};
	}, []);

	return (
		<Frame
			presentation="drawer"
			title={t("manageApproval.im.ops.set-feishu-config.title")}
			summary={t("manageApproval.im.ops.set-feishu-config.summary")}
			icon="icon-[mdi--message-text-lock-outline]"
			badge={t("manageApproval.im.ops.set-feishu-config.badge")}
			labels={frameLabels(request.permission, t("manageApproval.im.ops.set-feishu-config.confirm"))}
			responding={responding}
			countdown={approval.countdown.formatted}
			error={error}
			onReject={reject}
			onApprove={() => {
				if (!parsed) {
					approve();
					return;
				}
				approve({
					operation: "set-feishu-config",
					appId: form.appId.trim(),
					...(form.appSecret ? { appSecret: form.appSecret } : {}),
					...(form.verificationToken ? { verificationToken: form.verificationToken } : {}),
					...(form.encryptKey ? { encryptKey: form.encryptKey } : {}),
					...(form.baseUrl.trim() ? { baseUrl: form.baseUrl.trim() } : {}),
					...(parsed.enabled !== undefined ? { enabled: parsed.enabled } : {}),
					approvalUi: parsed.approvalUi ?? "im.set-feishu-config",
				});
			}}
			canApprove={Boolean(parsed) && form.appId.trim().length > 0}
		>
			{parsed ? (
				<>
					<ApprovalTargetCard
						icon="icon-[mdi--feather]"
						title={t("manageApproval.im.feishuTarget")}
						subtitle={t("manageApproval.im.feishuHint")}
					/>
					<ApprovalFormField id="im-feishu-app-id" label={t("manageApproval.fields.appId")}>
						<Input
							id="im-feishu-app-id"
							value={form.appId}
							onChange={(event) => setForm((prev) => ({ ...prev, appId: event.target.value }))}
						/>
					</ApprovalFormField>
					<ApprovalFormField id="im-feishu-app-secret" label={t("manageApproval.fields.appSecret")}>
						<Input
							id="im-feishu-app-secret"
							type="password"
							value={form.appSecret}
							placeholder={t("manageApproval.secretPlaceholder")}
							onChange={(event) => setForm((prev) => ({ ...prev, appSecret: event.target.value }))}
						/>
					</ApprovalFormField>
					<ApprovalFormField id="im-feishu-verification" label={t("manageApproval.fields.verificationToken")}>
						<Input
							id="im-feishu-verification"
							type="password"
							value={form.verificationToken}
							placeholder={t("manageApproval.secretPlaceholder")}
							onChange={(event) => setForm((prev) => ({ ...prev, verificationToken: event.target.value }))}
						/>
					</ApprovalFormField>
					<ApprovalFormField id="im-feishu-encrypt" label={t("manageApproval.fields.encryptKey")}>
						<Input
							id="im-feishu-encrypt"
							type="password"
							value={form.encryptKey}
							placeholder={t("manageApproval.secretPlaceholder")}
							onChange={(event) => setForm((prev) => ({ ...prev, encryptKey: event.target.value }))}
						/>
					</ApprovalFormField>
					<ApprovalFormField id="im-feishu-base-url" label={t("manageApproval.fields.baseUrl")}>
						<Input
							id="im-feishu-base-url"
							value={form.baseUrl}
							onChange={(event) => setForm((prev) => ({ ...prev, baseUrl: event.target.value }))}
						/>
					</ApprovalFormField>
					<ApprovalImpactCard
						icon="icon-[mdi--message-text-lock-outline]"
						title={t("manageApproval.afterActionTitle")}
						description={t("manageApproval.im.ops.set-feishu-config.impact")}
					/>
				</>
			) : (
				<ApprovalRawFallback input={request.input} />
			)}
		</Frame>
	);
}
