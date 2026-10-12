import { Button } from "@vetta-org/ui";
import { useTranslation } from "react-i18next";
import { useMcpToolsModel } from "../../hooks/useMcpToolsModel";
import type { AbilitiesModel, McpAbility } from "../../types";

export function McpToolsSection({ item, model }: { item: McpAbility; model: AbilitiesModel }): JSX.Element {
	const { t } = useTranslation("abilities");
	const state = useMcpToolsModel(
		item.serverName,
		item.installed && item.enabled && !item.setupRequired,
		model.mcp.config?.mcpServers[item.serverName],
	);
	return (
		<section className="flex flex-col gap-4" aria-label={t("mcp.tools.title")}>
			<div className="flex items-center gap-3">
				<span className="icon-[solar--code-square-linear] h-4 w-4 text-primary" aria-hidden="true" />
				<h2 className="text-[15px] font-semibold text-foreground">{t("mcp.tools.title")}</h2>
				{state.phase === "ready" ? (
					<span className="rounded-full bg-muted px-2 py-0.5 text-[11px] tabular-nums text-muted-foreground">
						{state.tools.length}
					</span>
				) : null}
				<span className="h-px flex-1 bg-border/40" aria-hidden="true" />
			</div>
			{!item.installed || !item.enabled || item.setupRequired ? (
				<p className="text-[12px] text-muted-foreground">
					{t(
						!item.installed
							? "mcp.tools.installFirst"
							: !item.enabled
								? "mcp.tools.enableFirst"
								: "mcp.tools.setupFirst",
					)}
				</p>
			) : state.phase === "loading" ? (
				<p role="status" className="flex items-center gap-2 text-[12px] text-muted-foreground">
					<span className="icon-[solar--refresh-linear] h-3.5 w-3.5 animate-spin" aria-hidden="true" />
					{t("mcp.tools.loading")}
				</p>
			) : state.phase === "error" ? (
				<div className="flex items-start justify-between gap-3 rounded-lg bg-destructive/10 p-3">
					<div role="alert" className="min-w-0 text-[12px] text-destructive">
						<p>{t("mcp.tools.error")}</p>
						{state.error ? (
							<p className="mt-2 whitespace-pre-wrap break-words font-mono leading-relaxed">{state.error}</p>
						) : null}
					</div>
					<Button variant="outline" size="sm" onClick={state.retry}>
						{t("mcp.tools.retry")}
					</Button>
				</div>
			) : state.tools.length === 0 ? (
				<p className="text-[12px] text-muted-foreground">{t("mcp.tools.empty")}</p>
			) : (
				<ul className="divide-y divide-border/40 rounded-xl border border-border/50 bg-card/40 px-4">
					{state.tools.map((tool) => (
						<li key={tool.name} className="py-4">
							<h3 className="break-all font-mono text-[12px] font-semibold text-foreground">{tool.name}</h3>
							<p className="mt-1.5 whitespace-pre-wrap break-words text-[12px] leading-relaxed text-muted-foreground">
								{tool.description || t("mcp.tools.noDescription")}
							</p>
						</li>
					))}
				</ul>
			)}
		</section>
	);
}
