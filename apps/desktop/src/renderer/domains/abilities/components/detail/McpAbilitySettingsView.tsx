import { InputField } from "@vetta/theme-ui/settings";
import { Button } from "@vetta/ui";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { existingSecretValues } from "../../../settings/mcp/builtin-mcp-presets";
import { useMcpSetupStatusModel } from "../../hooks/useMcpSetupStatusModel";
import type { AbilitiesModel, McpAbility } from "../../types";

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/** Dedicated settings surface for one managed MCP ability. */
export function McpAbilitySettingsView({
	item,
	model,
	onBack,
}: {
	item: McpAbility;
	model: AbilitiesModel;
	onBack: () => void;
}): JSX.Element {
	const { t, i18n } = useTranslation("abilities");
	const preset = item.preset;
	const server = model.mcp.config?.mcpServers[item.serverName];
	const status = useMcpSetupStatusModel(item, model.refresh, model.setupPromptId);
	const initialValues = useMemo(
		() => (preset && server ? existingSecretValues(preset, server) : {}),
		[preset, server],
	);
	const [values, setValues] = useState<Record<string, string>>(initialValues);
	const [saving, setSaving] = useState(false);
	const [clearing, setClearing] = useState(false);
	const [confirmClear, setConfirmClear] = useState(false);
	const [error, setError] = useState<string | undefined>();

	useEffect(() => setValues(initialValues), [initialValues]);

	const save = async (): Promise<void> => {
		if (!preset) return;
		setSaving(true);
		setError(undefined);
		try {
			await model.mcp.onSaveBuiltinParameters(item.serverName, preset, values);
			status?.retry();
		} catch (reason) {
			setError(errorMessage(reason));
		} finally {
			setSaving(false);
		}
	};

	const clearLogin = async (): Promise<void> => {
		if (!confirmClear) {
			setConfirmClear(true);
			return;
		}
		setClearing(true);
		setError(undefined);
		try {
			await window.vetta.mcp.clearSetupLogin(item.serverName);
			setConfirmClear(false);
			status?.retry();
			model.refresh();
		} catch (reason) {
			setError(errorMessage(reason));
		} finally {
			setClearing(false);
		}
	};

	const checkedAt = status?.checkedAt
		? new Intl.DateTimeFormat(i18n.language, {
				hour: "2-digit",
				minute: "2-digit",
				second: "2-digit",
			}).format(status.checkedAt)
		: undefined;

	return (
		<div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
			<div className="flex items-center gap-3">
				<Button variant="ghost" size="icon-sm" onClick={onBack} aria-label={t("mcp.settings.back")}>
					<span className="icon-[solar--arrow-left-linear] h-4 w-4" />
				</Button>
				<div>
					<h1 className="text-[18px] font-semibold text-foreground">{t("mcp.settings.title", { name: item.title })}</h1>
					<p className="mt-0.5 text-[12px] text-muted-foreground">{t("mcp.settings.description")}</p>
				</div>
			</div>

			<section className="rounded-xl border border-border/60 bg-card/40 p-4">
				<h2 className="text-[13px] font-semibold text-foreground">{t("mcp.loginStatusTitle")}</h2>
				<div className="mt-3 flex flex-wrap items-center justify-between gap-3">
					<div className="flex items-center gap-2 text-[12px] text-muted-foreground">
						<span
							className={
								status?.phase === "checking"
									? "icon-[solar--refresh-linear] h-4 w-4 animate-spin"
									: status?.phase === "authenticated"
										? "icon-[solar--check-circle-linear] h-4 w-4 text-emerald-400"
										: "icon-[solar--danger-circle-linear] h-4 w-4"
							}
						/>
						<span>
							{status?.phase === "authenticated"
								? status.username
									? t("mcp.loginAuthenticatedAs", { username: status.username })
									: t("mcp.loginAuthenticated")
								: status?.phase === "checking"
									? t("mcp.loginChecking")
									: status?.phase === "failed"
										? t("mcp.loginCheckFailed", { error: status.error ?? "" })
										: t("mcp.loginUnauthenticated")}
						</span>
					</div>
					<div className="flex items-center gap-2">
						{status?.phase === "authenticated" ? (
							<Button variant={confirmClear ? "destructive" : "outline"} size="sm" disabled={clearing} onClick={() => void clearLogin()}>
								{clearing
									? t("mcp.settings.clearing")
									: confirmClear
										? t("mcp.settings.confirmClearLogin")
										: t("mcp.settings.clearLogin")}
							</Button>
						) : (
							<Button variant="primary" size="sm" onClick={() => model.setup(item)}>
								{t("mcp.loginAction")}
							</Button>
						)}
						<Button variant="ghost" size="sm" onClick={() => status?.retry()}>
							{t("mcp.loginCheckRetry")}
						</Button>
					</div>
				</div>
				{checkedAt ? <p className="mt-2 text-[11px] text-muted-foreground/60">{t("mcp.settings.checkedAt", { time: checkedAt })}</p> : null}
			</section>

			{preset?.secrets?.length ? (
				<section className="rounded-xl border border-border/60 bg-card/40 p-4">
					<h2 className="text-[13px] font-semibold text-foreground">{t("mcp.settings.runtimeTitle")}</h2>
					<p className="mt-1 text-[11px] text-muted-foreground">{t("mcp.settings.runtimeDescription")}</p>
					<div className="mt-4 flex flex-col gap-3">
						{preset.secrets.map((field) => (
							<label key={field.envKey} className="block">
								<span className="mb-1 block text-[11px] text-muted-foreground">
									{field.envKey === "XHS_PROXY" ? t("mcp.settings.proxyLabel") : field.label || field.envKey}
									{field.required ? " *" : ` (${t("mcp.settings.optional")})`}
								</span>
								<InputField
									type={field.secret ? "password" : "text"}
									value={values[field.envKey] ?? ""}
									onChange={(value) => setValues((current) => ({ ...current, [field.envKey]: value }))}
									placeholder={field.placeholder}
								/>
								{field.envKey === "XHS_PROXY" ? (
									<span className="mt-1 block text-[10px] text-muted-foreground/60">{t("mcp.settings.proxyHint")}</span>
								) : null}
							</label>
						))}
					</div>
					<div className="mt-4 flex justify-end">
						<Button variant="primary" size="sm" disabled={saving} onClick={() => void save()}>
							{saving ? t("mcp.settings.saving") : t("mcp.settings.save")}
						</Button>
					</div>
				</section>
			) : null}

			{error ? <p className="rounded-lg bg-destructive/10 px-3 py-2 text-[12px] text-destructive">{error}</p> : null}
		</div>
	);
}
