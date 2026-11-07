import {
	Button,
	cn,
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@astravia-org/ui";
import { memo } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useAbilityText } from "../hooks/useAbilityText";
import type { AbilitiesModel, AbilityItem, McpAbility } from "../types";
import { AbilityIcon } from "./AbilityIcon";
import { AbilityStatusBadges } from "./AbilityBadges";
import { AbilityOperationStatus } from "./AbilityOperationStatus";
import { loadAbilityDetailView } from "./detail/loadAbilityDetailView";

/**
 * 卡片只需要这几个回调，而且它们必须是稳定引用：传整个 `model` 对象（每次渲染新建）
 * 会让 `memo` 永远失效，插件装得越多，一次搜索输入就要重渲越多行。
 */
export type AbilityCardActions = Pick<
	AbilitiesModel,
	"install" | "uninstall" | "toggle" | "reloadPlugin" | "setup" | "configure" | "edit" | "revokeAuthorization"
>;

function McpMenuItems({ item, actions }: { item: McpAbility; actions: AbilityCardActions }): JSX.Element {
	const { t } = useTranslation("abilities");
	return (
		<>
			{item.setupRequired && (
				<DropdownMenuItem onSelect={() => actions.setup(item)}>
					<span className="icon-[solar--settings-linear] h-3.5 w-3.5" />
					{t("actions.finishSetup")}
				</DropdownMenuItem>
			)}
			{item.usesOAuth && (
				<DropdownMenuItem
					onSelect={() => (item.authorized ? actions.revokeAuthorization(item) : actions.setup(item))}
				>
					<span
						className={cn(
							"h-3.5 w-3.5",
							item.authorized ? "icon-[solar--link-broken-linear]" : "icon-[solar--shield-keyhole-linear]",
						)}
					/>
					{item.authorized ? t("actions.disconnectAccount") : t("actions.connectAccount")}
				</DropdownMenuItem>
			)}
			{item.canConfigure && (
				<DropdownMenuItem onSelect={() => actions.configure(item)}>
					<span className="icon-[solar--key-minimalistic-square-linear] h-3.5 w-3.5" />
					{t("actions.configure")}
				</DropdownMenuItem>
			)}
			{item.canEdit && (
				<DropdownMenuItem onSelect={() => actions.edit(item)}>
					<span className="icon-[solar--pen-2-linear] h-3.5 w-3.5" />
					{t("actions.edit")}
				</DropdownMenuItem>
			)}
		</>
	);
}

function InstalledMoreMenu({
	item,
	actions,
	onOpenDetail,
}: {
	item: AbilityItem;
	actions: AbilityCardActions;
	onOpenDetail: () => void;
}): JSX.Element | null {
	const { t } = useTranslation("abilities");

	// 只读能力没有可执行的操作，右侧留空即可，不用「锁」占位。
	if (item.readonly) return null;

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button variant="ghost" size="icon-sm" aria-label={t("actions.more")}>
					<span className="icon-[solar--menu-dots-bold] h-3.5 w-3.5" />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="w-44">
				<DropdownMenuItem onSelect={onOpenDetail}>
					<span className="icon-[solar--eye-linear] h-3.5 w-3.5" />
					{t("actions.viewDetails")}
				</DropdownMenuItem>
				{item.type === "plugin" && (
					<DropdownMenuItem onSelect={() => actions.reloadPlugin(item)}>
						<span className="icon-[solar--restart-linear] h-3.5 w-3.5" />
						{item.pendingVersion
							? t("plugin.reloadVersion", { version: item.pendingVersion })
							: t("actions.reload")}
					</DropdownMenuItem>
				)}
				{item.needsUpdate && (
					<DropdownMenuItem onSelect={() => (item.type === "bundle" ? onOpenDetail() : actions.install(item))}>
						<span className="icon-[solar--refresh-linear] h-3.5 w-3.5" />
						{t("actions.update")}
					</DropdownMenuItem>
				)}
				{item.type === "mcp" && <McpMenuItems item={item} actions={actions} />}
				<DropdownMenuItem onSelect={() => actions.toggle(item)}>
					<span
						className={cn(
							"h-3.5 w-3.5",
							item.enabled ? "icon-[solar--pause-circle-linear]" : "icon-[solar--play-circle-linear]",
						)}
					/>
					{item.enabled ? t("actions.disable") : t("actions.enable")}
				</DropdownMenuItem>
				{item.type !== "bundle" && (
					<>
						<DropdownMenuSeparator />
						<DropdownMenuItem className="text-destructive" onSelect={() => actions.uninstall(item)}>
							<span className="icon-[solar--trash-bin-trash-linear] h-3.5 w-3.5" />
							{t("actions.remove")}
						</DropdownMenuItem>
					</>
				)}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

export const AbilityCard = memo(function AbilityCard({
	item,
	actions,
}: {
	item: AbilityItem;
	actions: AbilityCardActions;
}): JSX.Element {
	const { t } = useTranslation("abilities");
	const navigate = useNavigate();
	const { title, description } = useAbilityText()(item);

	const openDetail = (): void => {
		void navigate({ to: "/abilities", search: { detail: item.id } });
	};

	return (
		<div
			onClick={openDetail}
			onPointerEnter={() => void loadAbilityDetailView().catch(() => undefined)}
			onPointerDown={() => void loadAbilityDetailView().catch(() => undefined)}
			className={cn(
				"group relative flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 transition-colors duration-200 hover:bg-accent/60",
				!item.enabled && item.installed && "opacity-75",
			)}
		>
			<AbilityIcon icon={item.icon} type={item.type} />
			<div className="min-w-0 flex-1">
				<div className="flex min-w-0 flex-wrap items-center gap-1.5">
					<h3 className="truncate text-[13px] font-semibold text-foreground">{title}</h3>
					<AbilityStatusBadges item={item} />
				</div>
				{item.busy ? (
					<div className="mt-0.5 min-w-0 overflow-hidden text-[11px] leading-relaxed text-muted-foreground">
						<AbilityOperationStatus
							operation={item.operation}
							progress={item.operationProgress}
							className="max-w-full"
						/>
					</div>
				) : (
					<p className="mt-0.5 truncate text-[11px] leading-relaxed text-muted-foreground/70">
						{description || t("card.noDescription")}
					</p>
				)}
			</div>
			{!item.busy && (
				<div className="shrink-0" onClick={(event) => event.stopPropagation()}>
					{item.installed ? (
						<InstalledMoreMenu item={item} actions={actions} onOpenDetail={openDetail} />
					) : (
						<Button
							variant="ghost"
							size="icon-sm"
							aria-label={t("actions.add")}
							title={t("actions.add")}
							className="rounded-lg border border-transparent bg-transparent text-muted-foreground/60 transition-colors hover:border-border hover:bg-muted hover:text-foreground"
							onClick={() => (item.type === "bundle" ? openDetail() : actions.install(item))}
						>
							<span className="icon-[solar--add-linear] h-4 w-4" />
						</Button>
					)}
				</div>
			)}
		</div>
	);
});
