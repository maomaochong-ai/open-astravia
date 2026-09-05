import { Button } from "@vetta/ui";
import { useTranslation } from "react-i18next";
import { useMcpSetupStatusModel } from "../../hooks/useMcpSetupStatusModel";
import type { AbilitiesModel, McpAbility } from "../../types";

/** Lightweight login state for managed MCP abilities; advanced configuration stays in Settings. */
export function McpAbilitySection({
	item,
	model,
}: {
	item: McpAbility;
	model: AbilitiesModel;
}): JSX.Element | null {
	const { t } = useTranslation("abilities");
	const status = useMcpSetupStatusModel(item, model.refresh, model.setupPromptId);
	if (!status) return null;

	const preparingQrCode = model.setupPromptId === item.id;
	const authenticated = status.phase === "authenticated";
	const label = preparingQrCode
		? t("mcp.setupLoginPreparing")
		: authenticated
			? status.username
				? t("mcp.loginAuthenticatedAs", { username: status.username })
				: t("mcp.loginAuthenticated")
			: status.phase === "checking"
				? t("mcp.loginChecking")
				: status.phase === "failed"
					? t("mcp.loginCheckFailed", { error: status.error ?? "" })
					: t("mcp.loginUnauthenticated");

	return (
		<section className="flex flex-col gap-3" aria-live="polite">
			<h2 className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground/60">
				{t("mcp.loginStatusTitle")}
			</h2>
			<div className="flex items-center justify-between gap-4 py-1">
				<div className="flex min-w-0 items-center gap-2.5">
					<span
						className={
							preparingQrCode || status.phase === "checking"
								? "icon-[solar--refresh-linear] h-4 w-4 shrink-0 animate-spin text-muted-foreground"
								: authenticated
									? "icon-[solar--check-circle-linear] h-4 w-4 shrink-0 text-emerald-400"
									: "icon-[solar--danger-circle-linear] h-4 w-4 shrink-0 text-muted-foreground"
						}
					/>
					<p className="text-[12px] text-muted-foreground">{label}</p>
				</div>
				{status.phase === "failed" && !preparingQrCode ? (
					<Button variant="outline" size="sm" onClick={status.retry}>
						{t("mcp.loginCheckRetry")}
					</Button>
				) : !authenticated ? (
					<Button variant="primary" size="sm" disabled={preparingQrCode} onClick={() => model.setup(item)}>
						{t("mcp.loginAction")}
					</Button>
				) : null}
			</div>
		</section>
	);
}
