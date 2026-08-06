import { useState } from "react";
import { useTranslation } from "react-i18next";
import { McpDefaultIcon, McpJsonEditorView } from "@vetta/theme-ui/settings";
import { Button, Switch, cn } from "@vetta/ui";
import {
	isBuiltinMcpServer,
	matchBuiltinMcpPreset,
	missingRequiredSecrets,
	resolveMcpIcon,
	resolveMcpPresetDescription,
	resolveMcpPresetDisplayName,
	serverUsesOAuth,
} from "../mcp/builtin-mcp-presets";
import type { McpSettingsModel } from "./useMcpSettingsModel";

export type McpServerRowThemeViews = {
	readonly jsonEditor: typeof McpJsonEditorView;
};

/** 已添加 MCP 的宫格卡片。 */
export function McpServerRow({
	name,
	model,
	/** 来自远程市场的图标（本地 mcp.json 未写入 icon 时回退） */
	marketIcon,
}: {
	name: string;
	model: McpSettingsModel;
	marketIcon?: string;
}): JSX.Element | null {
	const { t } = useTranslation("settings");
	const server = model.config?.mcpServers[name];
	if (!server) return null;

	const isDisabled = server.disabled ?? false;
	const isBuiltin = isBuiltinMcpServer(name, server);
	const preset = matchBuiltinMcpPreset(name, server);
	const iconSrc = resolveMcpIcon(name, server) ?? (marketIcon?.trim() || null);
	const [failedIcon, setFailedIcon] = useState<string | null>(null);
	const showImg = Boolean(iconSrc) && failedIcon !== iconSrc;
	const needsSecrets = preset ? missingRequiredSecrets(preset, server).length > 0 : false;
	const canConfigureSecrets = Boolean(preset?.secrets?.length);
	const usesOAuth = serverUsesOAuth(name, server);
	const oauthAuthorized = Boolean(model.oauthAuthByName[name]);
	const oauthBusy = model.oauthBusyName === name;

	const displayTitle = preset ? resolveMcpPresetDisplayName(preset, (key) => t(key)) : server.displayName || name;
	const description = preset
		? resolveMcpPresetDescription(preset, (key) => t(key))
		: server.description?.trim() || "";

	return (
		<div
			className={cn(
				"group flex flex-col overflow-hidden rounded-xl bg-card transition-colors duration-200 hover:bg-accent",
				isDisabled && "opacity-75",
			)}
		>
			<div className="flex flex-1 flex-col gap-2.5 p-3.5">
				<div className="flex items-start gap-2.5">
					{showImg && iconSrc ? (
						<img
							src={iconSrc}
							alt=""
							className="h-10 w-10 shrink-0 rounded-lg object-contain"
							onError={() => setFailedIcon(iconSrc)}
						/>
					) : (
						<McpDefaultIcon className="h-10 w-10 rounded-lg" />
					)}
					<div className="min-w-0 flex-1">
						<div className="flex min-w-0 flex-wrap items-center gap-1.5">
							<h4
								className={cn(
									"truncate text-[13px] font-semibold tracking-tight",
									isDisabled ? "text-muted-foreground" : "text-foreground",
								)}
							>
								{displayTitle}
							</h4>
							{isDisabled && (
								<span className="shrink-0 rounded-full bg-accent px-1.5 py-0.5 text-[9px] font-medium text-muted-foreground">
									{t("disabledStatus")}
								</span>
							)}
							{needsSecrets && (
								<span className="shrink-0 rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-medium text-amber-400">
									{t("mcpPresets.needsSecrets")}
								</span>
							)}
							{usesOAuth && !oauthAuthorized && (
								<span className="shrink-0 rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-medium text-amber-400">
									{t("mcpPresets.needsAuth")}
								</span>
							)}
							{usesOAuth && oauthAuthorized && (
								<span className="shrink-0 rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[9px] font-medium text-emerald-500">
									{t("mcpPresets.authorized")}
								</span>
							)}
						</div>
						{description ? (
							<p className="mt-0.5 line-clamp-2 text-[11px] leading-relaxed text-muted-foreground/70">
								{description}
							</p>
						) : (
							<p className="mt-0.5 truncate text-[11px] text-muted-foreground/45">{name}</p>
						)}
					</div>
				</div>

				<div className="mt-auto flex items-center justify-between gap-2 pt-1">
					<Switch
						size="sm"
						checked={!isDisabled}
						onCheckedChange={() => {
							void model.onToggleDisabled(name);
						}}
						aria-label={isDisabled ? t("enable") : t("disable")}
						title={isDisabled ? t("enable") : t("disable")}
					/>
					<div className="flex shrink-0 items-center gap-0.5">
						{usesOAuth && (
							<>
								{!oauthAuthorized ? (
									<Button
										variant="ghost"
										size="icon-sm"
										disabled={oauthBusy}
										onClick={() => void model.onAuthorizeOAuth(name)}
										title={t("mcpPresets.authorize")}
										className="text-amber-400"
									>
										<span
											className={cn(
												"h-3.5 w-3.5",
												oauthBusy ? "icon-[mdi--loading] animate-spin" : "icon-[mdi--shield-key-outline]",
											)}
										/>
									</Button>
								) : (
									<Button
										variant="ghost"
										size="icon-sm"
										disabled={oauthBusy}
										onClick={() => void model.onRevokeOAuth(name)}
										title={t("mcpPresets.revokeAuth")}
									>
										<span
											className={cn(
												"h-3.5 w-3.5",
												oauthBusy ? "icon-[mdi--loading] animate-spin" : "icon-[mdi--link-off]",
											)}
										/>
									</Button>
								)}
							</>
						)}
						{canConfigureSecrets && (
							<Button
								variant="ghost"
								size="icon-sm"
								onClick={() => model.onConfigureBuiltinSecrets(name)}
								title={t("mcpPresets.configureSecrets")}
								className={needsSecrets ? "text-amber-400" : undefined}
							>
								<span className="icon-[mdi--key-variant] h-3.5 w-3.5" />
							</Button>
						)}
						{!isBuiltin && (
							<Button
								variant="ghost"
								size="icon-sm"
								onClick={() => model.onToggleEditServer(name)}
								title={t("edit")}
							>
								<span className="icon-[mdi--pencil-outline] h-3.5 w-3.5" />
							</Button>
						)}
						<Button
							variant="ghost"
							size="icon-sm"
							onClick={() => void model.onDeleteServer(name)}
							title={t("delete")}
							className="text-muted-foreground hover:text-destructive"
						>
							<span className="icon-[mdi--delete-outline] h-3.5 w-3.5" />
						</Button>
					</div>
				</div>
			</div>
		</div>
	);
}
