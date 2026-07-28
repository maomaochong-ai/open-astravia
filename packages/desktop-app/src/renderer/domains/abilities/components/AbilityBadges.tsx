import { cn } from "@vetta/ui";
import { useTranslation } from "react-i18next";
import { ABILITY_TYPE_ICON, ABILITY_TYPE_LABEL_KEY } from "../lib/ability-presentation";
import type { AbilityItem } from "../types";

export function AbilityTypeBadge({ item, className }: { item: AbilityItem; className?: string }): JSX.Element {
	const { t } = useTranslation("abilities");
	return (
		<span
			className={cn(
				"inline-flex shrink-0 items-center gap-1 rounded-full bg-accent/60 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground/80",
				className,
			)}
		>
			<span className={cn("h-3 w-3", ABILITY_TYPE_ICON[item.type])} />
			{t(ABILITY_TYPE_LABEL_KEY[item.type])}
		</span>
	);
}

export function AbilityStatusBadges({ item }: { item: AbilityItem }): JSX.Element {
	const { t } = useTranslation("abilities");
	return (
		<>
			{item.sameNameIds?.length ? (
				<span className="inline-flex shrink-0 items-center rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
					{t("status.sameName", { count: item.sameNameIds.length })}
				</span>
			) : null}
			{item.setupRequired && (
				<span className="inline-flex shrink-0 items-center rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-400">
					{t("status.setupRequired")}
				</span>
			)}
			{item.needsUpdate && (
				<span className="inline-flex shrink-0 items-center rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-400">
					{t("status.updateAvailable")}
				</span>
			)}
			{item.isCustom && (
				<span className="inline-flex shrink-0 items-center rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
					{t("status.custom")}
				</span>
			)}
			{item.isBuiltin && (
				<span className="inline-flex shrink-0 items-center rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
					{t("status.builtin")}
				</span>
			)}
			{item.readonly && !item.isBuiltin && (
				<span className="inline-flex shrink-0 items-center rounded-full bg-accent/60 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground/80">
					{t("status.readonly")}
				</span>
			)}
		</>
	);
}
