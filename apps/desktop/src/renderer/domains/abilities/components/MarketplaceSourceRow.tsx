import type { MarketplaceSource, OpenMarketplaceSourceSnapshot } from "@preload/api";
import { Button, Switch } from "@vetta/ui";
import { useState } from "react";
import { useTranslation } from "react-i18next";

/** 单条来源：内置来源只允许开关，自定义来源可编辑分支/名称并删除。 */
export function MarketplaceSourceRow({
	source,
	snapshot,
	failed,
	busy,
	onRefresh,
	onAutoUpdate,
	onToggle,
	onEdit,
	onRemove,
}: {
	source: MarketplaceSource;
	snapshot?: OpenMarketplaceSourceSnapshot;
	failed: boolean;
	busy: boolean;
	onRefresh: () => void;
	onAutoUpdate: (enabled: boolean) => void;
	onToggle: (enabled: boolean) => void;
	onEdit: () => void;
	onRemove: () => void;
}): JSX.Element {
	const { t } = useTranslation(["abilities", "common"]);
	const [confirmingRemove, setConfirmingRemove] = useState(false);

	return (
		<div className="flex items-center gap-3 rounded-xl border border-border/60 bg-card/40 px-3 py-2.5">
			<span className="icon-[mdi--github] h-5 w-5 shrink-0 text-muted-foreground/70" />
			<div className="min-w-0 flex-1">
				<div className="flex items-center gap-1.5">
					<span className="truncate text-[12px] font-semibold text-foreground">{source.name}</span>
					{source.builtin && (
						<span className="shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground/80">
							{t("abilities:sources.builtinBadge")}
						</span>
					)}
				</div>
				<p className="truncate text-[11px] text-muted-foreground/60">
					{source.repository.replace("https://github.com/", "")} · {source.ref}
				</p>
				<p role="status" className="text-[11px] text-muted-foreground/70">
					{!source.enabled
						? t("abilities:sources.status.disabled")
						: failed
							? t(snapshot?.marketplaceVersion ? "abilities:sources.status.cached" : "abilities:sources.status.failed")
							: snapshot?.marketplaceVersion
								? t("abilities:sources.status.ready", { version: snapshot.marketplaceVersion })
								: t("abilities:sources.status.pending")}
				</p>
				<label className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground/60">
					<Switch size="sm" checked={source.autoUpdate} disabled={busy} onCheckedChange={onAutoUpdate} />
					{t("abilities:sources.actions.autoUpdate")}
				</label>
			</div>
			{confirmingRemove ? (
				<div className="flex shrink-0 items-center gap-1.5">
					<Button size="sm" variant="ghost" disabled={busy} onClick={() => setConfirmingRemove(false)}>
						{t("common:actions.cancel")}
					</Button>
					<Button size="sm" variant="destructive" disabled={busy} onClick={onRemove}>
						{t("abilities:sources.actions.confirmRemove")}
					</Button>
				</div>
			) : (
				<div className="flex shrink-0 items-center gap-2">
					<Button
						size="sm"
						variant="ghost"
						disabled={busy || !source.enabled}
						aria-label={t("abilities:sources.actions.refresh", { name: source.name })}
						onClick={onRefresh}
					>
						<span className="icon-[solar--refresh-linear] h-3.5 w-3.5" />
					</Button>
					<Switch
						size="sm"
						checked={source.enabled}
						disabled={busy}
						aria-label={t("abilities:sources.actions.toggle")}
						onCheckedChange={onToggle}
					/>
					{!source.builtin && (
						<>
							<Button
								size="sm"
								variant="ghost"
								disabled={busy}
								title={t("abilities:sources.actions.edit")}
								onClick={onEdit}
							>
								<span className="icon-[solar--pen-2-linear] h-3.5 w-3.5" />
							</Button>
							<Button
								size="sm"
								variant="ghost"
								disabled={busy}
								title={t("abilities:sources.actions.remove")}
								onClick={() => setConfirmingRemove(true)}
							>
								<span className="icon-[solar--trash-bin-trash-linear] h-3.5 w-3.5" />
							</Button>
						</>
					)}
				</div>
			)}
		</div>
	);
}
