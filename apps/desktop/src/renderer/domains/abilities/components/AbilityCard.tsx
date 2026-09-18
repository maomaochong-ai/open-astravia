import {
	Button,
	cn,
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@vetta-org/ui";
import { useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useAbilityText } from "../hooks/useAbilityText";
import type { AbilitiesModel, AbilityItem, McpAbility } from "../types";
import { AbilityIcon } from "./AbilityIcon";
import { AbilityStatusBadges } from "./AbilityBadges";
import { AbilityOperationStatus } from "./AbilityOperationStatus";
import { loadAbilityDetailView } from "./detail/loadAbilityDetailView";

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

	// 只读能力没有可执行操作，悬停时展示精致轻微的详情指引箭头
	if (item.readonly) {
		return (
			<div className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground/25 transition-all duration-150 group-hover:translate-x-0.5 group-hover:text-muted-foreground/70">
				<span className="icon-[solar--alt-arrow-right-linear] h-3.5 w-3.5" />
			</div>
		);
	}
	if (item.busy) {
		return (
			<div className="px-2 py-1 text-[11px] text-muted-foreground">
				<AbilityOperationStatus operation={item.operation} progress={item.operationProgress} />
			</div>
		);
	}

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button
					variant="ghost"
					size="icon-sm"
					aria-label={t("actions.more")}
					className="h-7 w-7 rounded-lg text-muted-foreground/60 transition-colors hover:bg-secondary hover:text-foreground"
				>
					<span className="icon-[solar--menu-dots-bold] h-3.5 w-3.5" />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="w-44">
				<DropdownMenuItem onSelect={onOpenDetail}>
					<span className="icon-[solar--eye-linear] h-3.5 w-3.5" />
					{t("actions.viewDetails")}
				</DropdownMenuItem>
				{item.type === "plugin" && (
					<DropdownMenuItem onSelect={() => model.reloadPlugin(item)}>
						<span className="icon-[solar--restart-linear] h-3.5 w-3.5" />
						{item.pendingVersion
							? t("plugin.reloadVersion", { version: item.pendingVersion })
							: t("actions.reload")}
					</DropdownMenuItem>
				)}
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
			onPointerEnter={() => void loadAbilityDetailView().catch(() => undefined)}
			onPointerDown={() => void loadAbilityDetailView().catch(() => undefined)}
			className={cn(
				"group relative flex cursor-pointer items-start gap-3 rounded-xl border border-border/40 bg-card/35 p-3.5 transition-all duration-200 hover:border-border/80 hover:bg-card/75 hover:shadow-xs",
				!item.enabled && item.installed && "opacity-65",
			)}
		>
			<AbilityIcon icon={item.icon} type={item.type} className="mt-0.5" />
			<div className="min-w-0 flex-1 flex flex-col justify-between self-stretch">
				<div>
					<div className="flex items-start justify-between gap-1.5">
						<div className="flex min-w-0 flex-wrap items-center gap-1.5">
							<h3 className="truncate text-[13px] font-semibold text-foreground tracking-tight transition-colors group-hover:text-foreground">
								{title}
							</h3>
							<AbilityStatusBadges item={item} />
						</div>
						<div className="shrink-0 -mr-1 -mt-0.5" onClick={(event) => event.stopPropagation()}>
							{item.installed ? (
								<InstalledMoreMenu item={item} model={model} onOpenDetail={openDetail} />
							) : (
								<Button
									variant="ghost"
									size="icon-sm"
									disabled={item.busy}
									aria-label={t("actions.add")}
									title={t("actions.add")}
									className="h-7 w-7 rounded-lg border border-border/40 bg-secondary/40 text-muted-foreground/70 transition-all duration-150 group-hover:border-border/80 group-hover:bg-secondary/80 group-hover:text-foreground hover:!border-primary hover:!bg-primary hover:!text-primary-foreground"
									onClick={() => (item.type === "bundle" ? openDetail() : model.install(item))}
								>
									{item.busy ? (
										<AbilityOperationStatus operation={item.operation} progress={item.operationProgress} />
									) : (
										<span className="icon-[solar--add-linear] h-4 w-4" />
									)}
								</Button>
							)}
						</div>
					</div>
					<p className="mt-1 line-clamp-2 min-h-[2.25rem] text-[12px] leading-[1.45] text-muted-foreground/70 transition-colors group-hover:text-muted-foreground/90">
						{description || t("card.noDescription")}
					</p>
				</div>
			</div>
		</div>
	);
}
