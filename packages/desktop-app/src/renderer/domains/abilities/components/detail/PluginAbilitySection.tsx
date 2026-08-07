import { Button, Switch } from "@vetta/ui";
import { useTranslation } from "react-i18next";
import { PLUGIN_PERMISSION_LABEL_KEYS, pluginSourceLabelKey } from "../../lib/plugin-permission-labels";
import type { AbilitiesModel, PluginAbility } from "../../types";
import { PluginAgentModeSection } from "./PluginAgentModeSection";
import { PluginContributionsSection } from "./PluginContributionsSection";

/**
 * plugin 专属区块：权限清单（只读）与命令开关。
 * 权限的授予与解释放在详情页的二级权限视图；系统插件权限自动授予、不可改。
 */
export function PluginAbilitySection({
	item,
	model,
}: {
	item: PluginAbility;
	model: AbilitiesModel;
}): JSX.Element | null {
	const { t } = useTranslation("abilities");
	const plugin = item.plugin;
	const isSystem = plugin?.source === "system";
	const editable = plugin !== null && !isSystem;

	const contributions = item.market?.config.contributions;
	const hasContributions = Boolean(contributions?.mcp_servers?.length || contributions?.skills?.length);

	if (item.permissions.length === 0 && item.commands.length === 0 && !hasContributions && !plugin) return null;

	return (
		<section className="flex flex-col gap-5">
			{plugin ? (
				<div className="grid grid-cols-2 gap-2 text-[12px]">
					<div className="rounded-lg bg-muted px-3 py-2">
						<div className="text-muted-foreground/60">{t("plugin.currentVersion")}</div>
						<div className="mt-0.5 font-medium tabular-nums text-foreground">{plugin.activeVersion}</div>
					</div>
					<div className="rounded-lg bg-muted px-3 py-2">
						<div className="text-muted-foreground/60">{t("plugin.source.label")}</div>
						<div className="mt-0.5 font-medium text-foreground">{t(pluginSourceLabelKey(plugin.source))}</div>
					</div>
				</div>
			) : null}

			{item.pendingVersion ? (
				<div className="flex items-center justify-between gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2.5">
					<div className="text-[12px] text-amber-500">
						{t("plugin.reloadable", { version: item.pendingVersion })}
					</div>
					<Button variant="outline" size="sm" disabled={item.busy} onClick={() => model.reloadPlugin(item)}>
						<span className="icon-[solar--refresh-linear] h-3.5 w-3.5" />
						{t("actions.reload")}
					</Button>
				</div>
			) : null}

			<PluginAgentModeSection item={item} />

			<PluginContributionsSection item={item} />

			<div>
				<div className="mb-2 flex items-center gap-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground/60">
					{t("plugin.permissions")}
					{isSystem ? (
						<span className="text-[11px] font-normal text-muted-foreground">
							{t("plugin.permissionsSystemHint")}
						</span>
					) : null}
				</div>
				{/* 这里只保留可扫描的清单；授予与解释在二级权限视图中完成。 */}
				{item.permissions.length > 0 ? (
					<div className="grid grid-cols-3 gap-x-4 gap-y-1">
						{item.permissions.map((permission) => (
							<div key={permission} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
								<span className="icon-[solar--shield-check-linear] h-3 w-3 shrink-0 text-muted-foreground/50" />
								<span className="min-w-0 flex-1 truncate">
									{t(PLUGIN_PERMISSION_LABEL_KEYS[permission])}
								</span>
							</div>
						))}
					</div>
				) : (
					<div className="text-[11px] text-muted-foreground">{t("plugin.noPermissions")}</div>
				)}
			</div>

			{item.commands.length > 0 ? (
				<div>
					<div className="mb-2 flex items-center gap-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground/60">
						{t("plugin.commands")}
						<span className="text-[11px] font-normal text-muted-foreground">{t("plugin.commandsHint")}</span>
					</div>
					<div className="flex flex-col gap-1.5">
						{item.commands.map((command) => (
							<label
								key={command}
								className="flex items-center justify-between gap-2 rounded-lg border border-border bg-background/50 px-2.5 py-2"
							>
								<span className="flex items-center gap-1.5 text-[12px] text-foreground">
									<span className="icon-[solar--command-linear] h-3.5 w-3.5 text-muted-foreground" />
									<code className="font-mono">{command}</code>
								</span>
								<Switch
									checked={editable ? item.grantedCommands.includes(command) : true}
									disabled={!editable || item.busy}
									onCheckedChange={(checked) => model.setPluginCommand(item, command, checked)}
								/>
							</label>
						))}
					</div>
				</div>
			) : null}
		</section>
	);
}
