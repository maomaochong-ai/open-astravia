import { Button, cn } from "@vetta/ui";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
	resolveAbilityPrimaryAction,
	resolveAbilitySecondaryActions,
	resolveAbilityStatus,
	type AbilitySecondaryAction,
} from "../../lib/ability-detail-actions";
import { useAbilityText } from "../../hooks/useAbilityText";
import type { AbilityItem } from "../../types";
import { AbilityIcon } from "../AbilityIcon";
import { AbilityStatusBadges, AbilityTypeBadge } from "../AbilityBadges";

const SECONDARY_ICONS: Record<AbilitySecondaryAction, string> = {
	disable: "icon-[solar--pause-circle-linear]",
	configure: "icon-[solar--key-minimalistic-square-linear]",
	remove: "icon-[solar--trash-bin-trash-linear]",
};

/** 通用壳层：图标 / 标题 / 作者 / 版本 / 状态 / 描述 / 主次 CTA。 */
export function AbilityDetailHeader({
	item,
	onPrimary,
	onSecondary,
	primaryAside,
}: {
	item: AbilityItem;
	onPrimary: () => void;
	onSecondary: (kind: AbilitySecondaryAction) => void;
	/** 主 CTA 右侧的次要动作（如插件的权限配置入口）。 */
	primaryAside?: ReactNode;
}): JSX.Element {
	const { t } = useTranslation("abilities");
	const { title, description } = useAbilityText()(item);
	const status = resolveAbilityStatus(item);
	const primary = resolveAbilityPrimaryAction(item, status);
	const secondaries = resolveAbilitySecondaryActions(item, status);

	return (
		<div className="border-b border-border/60 pb-6">
			<div className="flex items-start gap-4">
				<AbilityIcon icon={item.icon} type={item.type} className="h-14 w-14 rounded-2xl" iconClassName="h-7 w-7" />
				<div className="min-w-0 flex-1">
					<div className="flex flex-wrap items-center gap-2">
						<h1 className="truncate text-[19px] font-semibold leading-snug text-foreground">{title}</h1>
						<AbilityTypeBadge item={item} />
						<span
							className={cn(
								"inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium",
								status === "enabled" && "bg-emerald-500/15 text-emerald-400",
								status === "setup_required" && "bg-amber-500/15 text-amber-400",
								(status === "available" || status === "disabled") && "bg-muted text-muted-foreground",
								status === "readonly" && "bg-accent/60 text-muted-foreground/80",
							)}
						>
							{t(`detail.status.${status}`)}
						</span>
						<AbilityStatusBadges item={item} />
					</div>

					<dl className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground/70">
						{item.author ? (
							<span>
								<dt className="inline">{t("detail.meta.author")}</dt>
								<dd className="ml-1 inline text-foreground/80">{item.author}</dd>
							</span>
						) : null}
						{item.version ? (
							<span>
								<dt className="inline">{t("detail.meta.version")}</dt>
								<dd className="ml-1 inline tabular-nums text-foreground/80">{item.version}</dd>
							</span>
						) : null}
						{item.localVersion && item.localVersion !== item.version ? (
							<span>
								<dt className="inline">{t("detail.meta.localVersion")}</dt>
								<dd className="ml-1 inline tabular-nums text-foreground/80">{item.localVersion}</dd>
							</span>
						) : null}
						{item.downloadCount > 0 ? (
							<span>
								<dt className="inline">{t("detail.meta.downloads")}</dt>
								<dd className="ml-1 inline tabular-nums text-foreground/80">{item.downloadCount}</dd>
							</span>
						) : null}
						{item.license ? (
							<span>
								<dt className="inline">{t("detail.meta.license")}</dt>
								<dd className="ml-1 inline text-foreground/80">{item.license}</dd>
							</span>
						) : null}
					</dl>
				</div>
			</div>

			{/* 描述与标签落在图标下方，与图标左对齐 */}
			{description ? (
				<p className="mt-4 text-[13px] leading-relaxed text-muted-foreground">{description}</p>
			) : null}

			{item.tags.length > 0 ? (
				<div className="mt-3 flex flex-wrap gap-1.5">
					{item.tags.map((tag) => (
						<span
							key={tag}
							className="rounded-full bg-primary/10 px-2.5 py-0.5 text-[11px] font-medium text-primary/90"
						>
							{tag}
						</span>
					))}
				</div>
			) : null}

			{primary !== "none" || primaryAside || secondaries.length > 0 ? (
				<div className="mt-5 flex flex-wrap items-center gap-2">
					{primary !== "none" ? (
						<Button
							variant="primary"
							className="min-w-40 flex-1"
							size="lg"
							disabled={item.busy}
							onClick={onPrimary}
						>
							{item.busy ? (
								<span className="icon-[solar--refresh-linear] h-4 w-4 animate-spin" />
							) : (
								<span className="icon-[solar--play-circle-bold] h-4 w-4" />
							)}
							{t(`detail.primary.${primary}`)}
						</Button>
					) : null}
					{secondaries
						.filter((kind) => kind !== "remove")
						.map((kind) => (
							<Button
								key={kind}
								variant="secondary"
								size="lg"
								disabled={item.busy}
								// 没有主 CTA（已启用）时，由停用/配置顶替它撑满这一行
								className={cn(primary === "none" && "min-w-40 flex-1")}
								onClick={() => onSecondary(kind)}
							>
								<span className={cn("h-4 w-4", SECONDARY_ICONS[kind])} />
								{t(`detail.secondary.${kind}`)}
							</Button>
						))}
					{/* 类型专属入口居中，移除永远在最右 */}
					{primaryAside}
					{secondaries.includes("remove") ? (
						<Button
							variant="outline"
							size="lg"
							disabled={item.busy}
							className="border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive"
							onClick={() => onSecondary("remove")}
						>
							<span className={cn("h-4 w-4", SECONDARY_ICONS.remove)} />
							{t("detail.secondary.remove")}
						</Button>
					) : null}
				</div>
			) : null}
		</div>
	);
}
