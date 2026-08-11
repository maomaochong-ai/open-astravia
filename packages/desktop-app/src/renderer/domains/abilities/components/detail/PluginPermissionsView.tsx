import type { PluginPermission } from "@preload/api";
import { Button, cn, Switch } from "@vetta/ui";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAbilityText } from "../../hooks/useAbilityText";
import {
	PLUGIN_PERMISSION_GROUPS,
	PLUGIN_PERMISSION_LABEL_KEYS,
	PLUGIN_PERMISSION_PRESENTATIONS,
	type PluginPermissionGroup,
	type PluginPermissionRisk,
} from "../../lib/plugin-permission-labels";
import type { AbilitiesModel, PluginAbility } from "../../types";
import { PluginPermissionVisual } from "./PluginPermissionVisual";

const GROUP_ICONS: Record<PluginPermissionGroup, string> = {
	interface: "icon-[solar--widget-5-linear]",
	projectData: "icon-[solar--folder-with-files-linear]",
	agent: "icon-[solar--chat-round-dots-linear]",
	execution: "icon-[solar--command-linear]",
	intelligence: "icon-[solar--magic-stick-3-linear]",
};

const RISK_CLASSES: Record<PluginPermissionRisk, string> = {
	low: "bg-muted text-muted-foreground",
	medium: "bg-amber-500/15 text-amber-400",
	high: "bg-destructive/10 text-destructive",
};

const RISK_ICONS: Record<PluginPermissionRisk, string> = {
	low: "icon-[solar--shield-check-linear]",
	medium: "icon-[solar--shield-warning-linear]",
	high: "icon-[solar--danger-triangle-linear]",
};

function RiskBadge({ risk }: { risk: PluginPermissionRisk }): JSX.Element {
	const { t } = useTranslation("abilities");
	return (
		<span className={cn("inline-flex shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium", RISK_CLASSES[risk])}>
			{t(`permission.risk.${risk}`)}
		</span>
	);
}

function RiskIndicator({ risk }: { risk: PluginPermissionRisk }): JSX.Element {
	const { t } = useTranslation("abilities");
	const label = t(`permission.risk.${risk}`);
	return (
		<span
			className={cn("mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg", RISK_CLASSES[risk])}
			aria-label={label}
			title={label}
		>
			<span className={cn("h-3.5 w-3.5", RISK_ICONS[risk])} />
		</span>
	);
}

function PermissionControl({
	item,
	model,
	permission,
}: {
	item: PluginAbility;
	model: AbilitiesModel;
	permission: PluginPermission;
}): JSX.Element {
	const { t } = useTranslation("abilities");
	const plugin = item.plugin;
	if (!plugin) {
		return (
			<span
				className="flex h-7 w-7 items-center justify-center text-muted-foreground/50"
				aria-label={t("permission.page.status.configureOnInstall")}
				title={t("permission.page.status.configureOnInstall")}
			>
				<span className="icon-[solar--clock-circle-linear] h-3.5 w-3.5" />
			</span>
		);
	}
	if (plugin.source === "system") {
		return (
			<span
				className="flex h-7 w-7 items-center justify-center text-muted-foreground/50"
				aria-label={t("permission.page.status.systemGranted")}
				title={t("permission.page.status.systemGranted")}
			>
				<span className="icon-[solar--lock-keyhole-minimalistic-linear] h-3.5 w-3.5" />
			</span>
		);
	}
	const label = t(PLUGIN_PERMISSION_LABEL_KEYS[permission]);
	return (
		<Switch
			className="shrink-0"
			aria-label={t("permission.page.toggleLabel", { permission: label })}
			checked={item.grantedPermissions.includes(permission)}
			disabled={item.busy}
			onCheckedChange={(checked) => model.setPluginPermission(item, permission, checked)}
		/>
	);
}

function PermissionRow({
	item,
	model,
	permission,
	selected,
	onSelect,
}: {
	item: PluginAbility;
	model: AbilitiesModel;
	permission: PluginPermission;
	selected: boolean;
	onSelect: () => void;
}): JSX.Element {
	const { t } = useTranslation("abilities");
	const presentation = PLUGIN_PERMISSION_PRESENTATIONS[permission];
	return (
		<div className={cn("flex items-center gap-2 border-b border-border/50 last:border-b-0", selected && "bg-primary/5")}>
			<button
				type="button"
				className="flex min-w-0 flex-1 items-start gap-2.5 px-3 py-2.5 text-left outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
				aria-pressed={selected}
				onClick={onSelect}
			>
				<RiskIndicator risk={presentation.risk} />
				<span className="min-w-0 flex-1">
					<span className="block truncate text-[12px] font-medium text-foreground">
						{t(PLUGIN_PERMISSION_LABEL_KEYS[permission])}
					</span>
					<span className="mt-1 block line-clamp-2 text-[11px] leading-relaxed text-muted-foreground">
						{t(presentation.descriptionKey)}
					</span>
				</span>
			</button>
			<div className="flex w-12 shrink-0 justify-center pr-3">
				<PermissionControl item={item} model={model} permission={permission} />
			</div>
		</div>
	);
}

function PermissionInsight({ permission }: { permission: PluginPermission }): JSX.Element {
	const { t } = useTranslation("abilities");
	const presentation = PLUGIN_PERMISSION_PRESENTATIONS[permission];
	return (
		<aside className="self-start border-t border-border/60 pt-5 @2xl:sticky @2xl:top-4 @2xl:border-l @2xl:border-t-0 @2xl:pl-5 @2xl:pt-0">
			<div className="flex items-start justify-between gap-3">
				<div className="min-w-0">
					<div className="mb-1 flex items-center gap-1.5 text-[10px] font-medium uppercase text-muted-foreground/60">
						<span className="icon-[solar--verified-check-linear] h-3 w-3" />
						{t("permission.page.hostVerified")}
					</div>
					<h2 className="text-[15px] font-semibold text-foreground">
						{t(PLUGIN_PERMISSION_LABEL_KEYS[permission])}
					</h2>
				</div>
				<RiskBadge risk={presentation.risk} />
			</div>

			<p className="mt-2 text-[12px] leading-relaxed text-muted-foreground">
				{t(presentation.descriptionKey)}
			</p>

			<div className="mt-5">
				<PluginPermissionVisual permission={permission} />
			</div>

			<dl className="mt-5 divide-y divide-border/50 border-y border-border/50">
				<div className="py-3">
					<dt className="flex items-center gap-1.5 text-[11px] font-medium text-foreground">
						<span className="icon-[solar--target-linear] h-3.5 w-3.5 text-muted-foreground" />
						{t("permission.page.scopeTitle")}
					</dt>
					<dd className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
						{t(`permission.page.scope.${presentation.visual}`)}
					</dd>
				</div>
				<div className="py-3">
					<dt className="flex items-center gap-1.5 text-[11px] font-medium text-foreground">
						<span className="icon-[solar--shield-warning-linear] h-3.5 w-3.5 text-muted-foreground" />
						{t("permission.page.disabledTitle")}
					</dt>
					<dd className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
						{t(`permission.page.disabled.${presentation.visual}`)}
					</dd>
				</div>
			</dl>
		</aside>
	);
}

export function PluginPermissionsView({
	item,
	model,
	onBack,
}: {
	item: PluginAbility;
	model: AbilitiesModel;
	onBack: () => void;
}): JSX.Element {
	const { t } = useTranslation("abilities");
	const { title } = useAbilityText()(item);
	const [selectedPermission, setSelectedPermission] = useState<PluginPermission>(item.permissions[0]);
	const groups = useMemo(
		() =>
			PLUGIN_PERMISSION_GROUPS.map((group) => ({
				group,
				permissions: item.permissions.filter(
					(permission) => PLUGIN_PERMISSION_PRESENTATIONS[permission].group === group,
				),
			})).filter(({ permissions }) => permissions.length > 0),
		[item.permissions],
	);
	const highRiskCount = item.permissions.filter(
		(permission) => PLUGIN_PERMISSION_PRESENTATIONS[permission].risk === "high",
	).length;
	const grantedCount = item.plugin?.source === "system" ? item.permissions.length : item.grantedPermissions.length;
	const readOnlyReason = !item.plugin
		? t("permission.page.readOnly.install")
		: item.plugin.source === "system"
			? t("permission.page.readOnly.system")
			: null;

	return (
		<div className="@container mx-auto flex w-full max-w-5xl flex-col">
			<header className="border-b border-border/60 pb-5">
				<div className="flex items-start gap-3">
					<Button
						variant="ghost"
						size="icon"
						className="mt-0.5"
						aria-label={t("permission.page.back")}
						onClick={onBack}
					>
						<span className="icon-[solar--alt-arrow-left-linear] h-4 w-4" />
					</Button>
					<div className="min-w-0 flex-1">
						<div className="flex items-center gap-2">
							<span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
								<span className="icon-[solar--shield-keyhole-linear] h-5 w-5" />
							</span>
							<div className="min-w-0">
								<h1 className="truncate text-[15px] font-semibold text-foreground">{t("permission.page.title")}</h1>
								<p className="truncate text-[11px] text-muted-foreground">{title}</p>
							</div>
						</div>
						<p className="mt-3 max-w-2xl text-[12px] leading-relaxed text-muted-foreground">
							{t("permission.page.description")}
						</p>
					</div>
				</div>
			</header>

			<div className="grid grid-cols-2 gap-2 py-5 @lg:grid-cols-3">
				<div className="rounded-xl bg-muted/45 px-3.5 py-3">
					<div className="text-[10px] text-muted-foreground">{t("permission.page.summary.requested")}</div>
					<div className="mt-1 text-[15px] font-semibold tabular-nums text-foreground">{item.permissions.length}</div>
				</div>
				<div className="rounded-xl bg-muted/45 px-3.5 py-3">
					<div className="text-[10px] text-muted-foreground">{t("permission.page.summary.highRisk")}</div>
					<div className={cn("mt-1 text-[15px] font-semibold tabular-nums", highRiskCount > 0 ? "text-destructive" : "text-foreground")}>
						{highRiskCount}
					</div>
				</div>
				<div className="col-span-2 rounded-xl bg-muted/45 px-3.5 py-3 @lg:col-span-1">
					<div className="text-[10px] text-muted-foreground">
						{item.plugin ? t("permission.page.summary.granted") : t("permission.page.summary.timing")}
					</div>
					<div className="mt-1 text-[15px] font-semibold tabular-nums text-foreground">
						{item.plugin ? `${grantedCount} / ${item.permissions.length}` : t("permission.page.summary.onInstall")}
					</div>
				</div>
			</div>

			{readOnlyReason ? (
				<div className="mb-5 flex items-start gap-2 rounded-lg bg-muted/45 px-3 py-2.5 text-[11px] leading-relaxed text-muted-foreground">
					<span className="icon-[solar--lock-keyhole-minimalistic-linear] mt-0.5 h-3.5 w-3.5 shrink-0" />
					<span>{readOnlyReason}</span>
				</div>
			) : null}

			<div className="grid min-w-0 gap-6 @2xl:grid-cols-[minmax(0,1fr)_18rem]">
				<div className="min-w-0 space-y-5">
					{groups.map(({ group, permissions }) => (
						<section key={group}>
							<div className="mb-2 flex items-start gap-2">
								<span className={cn("mt-0.5 h-4 w-4 shrink-0 text-muted-foreground", GROUP_ICONS[group])} />
								<div>
									<h2 className="text-[12px] font-medium text-foreground">{t(`permission.group.${group}.title`)}</h2>
									<p className="mt-0.5 text-[10px] leading-relaxed text-muted-foreground">
										{t(`permission.group.${group}.description`)}
									</p>
								</div>
							</div>
							<div className="overflow-hidden rounded-xl border border-border/60 bg-card/30">
								{permissions.map((permission) => (
									<PermissionRow
										key={permission}
										item={item}
										model={model}
										permission={permission}
										selected={selectedPermission === permission}
										onSelect={() => setSelectedPermission(permission)}
									/>
								))}
							</div>
						</section>
					))}
				</div>
				<PermissionInsight permission={selectedPermission} />
			</div>
		</div>
	);
}
