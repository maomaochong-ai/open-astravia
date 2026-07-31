import {
	Button,
	cn,
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@vetta/ui";
import { useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useAbilityText } from "../hooks/useAbilityText";
import type { AbilitiesModel, AbilityItem, McpAbility } from "../types";
import { AbilityIcon } from "./AbilityIcon";
import { AbilityStatusBadges } from "./AbilityBadges";

function McpMenuItems({ item, model }: { item: McpAbility; model: AbilitiesModel }): JSX.Element {
	const { t } = useTranslation("abilities");
	return (
		<>
			{item.setupRequired && (
				<DropdownMenuItem onSelect={() => model.setup(item)}>
					<span className="icon-[solar--settings-linear] h-3.5 w-3.5" />
					{t("actions.finishSetup")}
				</DropdownMenuItem>
			)}
			{item.usesOAuth && (
				<DropdownMenuItem
					onSelect={() => (item.authorized ? model.revokeAuthorization(item) : model.setup(item))}
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
				<DropdownMenuItem onSelect={() => model.configure(item)}>
					<span className="icon-[solar--key-minimalistic-square-linear] h-3.5 w-3.5" />
					{t("actions.configure")}
				</DropdownMenuItem>
			)}
			{item.canEdit && (
				<DropdownMenuItem onSelect={() => model.edit(item)}>
					<span className="icon-[solar--pen-2-linear] h-3.5 w-3.5" />
					{t("actions.edit")}
				</DropdownMenuItem>
			)}
		</>
	);
}

function InstalledMoreMenu({
	item,
	model,
	onOpenDetail,
}: {
	item: AbilityItem;
	model: AbilitiesModel;
	onOpenDetail: () => void;
}): JSX.Element | null {
	const { t } = useTranslation("abilities");

	// 只读能力没有可执行的操作，右侧留空即可，不用「锁」占位。
	if (item.readonly) return null;

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button variant="ghost" size="icon-sm" disabled={item.busy} aria-label={t("actions.more")}>
					{item.busy ? (
						<span className="icon-[solar--refresh-linear] h-3.5 w-3.5 animate-spin" />
					) : (
						<span className="icon-[solar--menu-dots-bold] h-3.5 w-3.5" />
					)}
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="w-44">
				<DropdownMenuItem onSelect={onOpenDetail}>
					<span className="icon-[solar--eye-linear] h-3.5 w-3.5" />
					{t("actions.viewDetails")}
				</DropdownMenuItem>
				{item.needsUpdate && (
					<DropdownMenuItem onSelect={() => (item.type === "bundle" ? onOpenDetail() : model.install(item))}>
						<span className="icon-[solar--refresh-linear] h-3.5 w-3.5" />
						{t("actions.update")}
					</DropdownMenuItem>
				)}
				{item.type === "mcp" && <McpMenuItems item={item} model={model} />}
				<DropdownMenuItem onSelect={() => model.toggle(item)}>
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
						<DropdownMenuItem className="text-destructive" onSelect={() => model.uninstall(item)}>
							<span className="icon-[solar--trash-bin-trash-linear] h-3.5 w-3.5" />
							{t("actions.remove")}
						</DropdownMenuItem>
					</>
				)}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

export function AbilityCard({ item, model }: { item: AbilityItem; model: AbilitiesModel }): JSX.Element {
	const { t } = useTranslation("abilities");
	const navigate = useNavigate();
	const { title, description } = useAbilityText()(item);

	const openDetail = (): void => {
		void navigate({ to: "/abilities", search: { detail: item.id } });
	};

	return (
		<div
			onClick={openDetail}
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
				<p className="mt-0.5 truncate text-[11px] leading-relaxed text-muted-foreground/70">
					{description || t("card.noDescription")}
				</p>
			</div>
			<div className="shrink-0" onClick={(event) => event.stopPropagation()}>
				{item.installed ? (
					<InstalledMoreMenu item={item} model={model} onOpenDetail={openDetail} />
				) : (
					<Button
						variant="secondary"
						size="sm"
						disabled={item.busy}
						className="border border-border bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground"
						onClick={() => (item.type === "bundle" ? openDetail() : model.install(item))}
					>
						{item.busy ? <span className="icon-[solar--refresh-linear] h-3.5 w-3.5 animate-spin" /> : null}
						{t("actions.add")}
					</Button>
				)}
			</div>
		</div>
	);
}
