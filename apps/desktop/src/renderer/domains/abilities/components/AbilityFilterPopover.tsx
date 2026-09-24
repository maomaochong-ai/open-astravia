import type { AbilityType } from "@shared/lib/api";
import { Button, cn, Popover, PopoverContent, PopoverTrigger } from "@vetta-org/ui";
import { useTranslation } from "react-i18next";
import { type AbilityFilter, type AbilityProvenanceFilter, EMPTY_ABILITY_FILTER } from "../types";

const TYPE_ORDER: AbilityType[] = ["skill", "mcp", "plugin", "bundle", "scene"];
const PROVENANCE_ORDER: AbilityProvenanceFilter[] = ["all", "market", "builtin"];

/** 生效中的筛选项数；按钮用它提示「列表被筛过」，否则面板一关用户会以为能力丢了。 */
export function countActiveAbilityFilters(filter: AbilityFilter): number {
	return filter.types.length + (filter.provenance === "all" ? 0 : 1);
}

/** 能力列表筛选：平时只是一个图标按钮，点开后按类型（多选）与来源（仅「公开」）筛选。 */
export function AbilityFilterPopover({
	filter,
	counts,
	showProvenance,
	onChange,
}: {
	filter: AbilityFilter;
	/** 各类型在当前分区与搜索下的数量，不受类型筛选本身影响。 */
	counts: Record<AbilityType, number>;
	/** 「个人」分区没有来源维度，隐藏该组。 */
	showProvenance: boolean;
	onChange: (filter: AbilityFilter) => void;
}): JSX.Element {
	const { t } = useTranslation("abilities");
	const activeCount = countActiveAbilityFilters(filter);

	const toggleType = (type: AbilityType) => {
		const types = filter.types.includes(type)
			? filter.types.filter((current) => current !== type)
			: [...filter.types, type];
		onChange({ ...filter, types });
	};

	return (
		<Popover>
			<PopoverTrigger asChild>
				<Button
					type="button"
					variant="ghost"
					size="sm"
					aria-label={t("filter.trigger")}
					title={t("filter.trigger")}
					className={cn(activeCount > 0 ? "text-foreground" : "text-muted-foreground/60")}
				>
					<span className="icon-[solar--filter-linear] h-3.5 w-3.5" />
					{activeCount > 0 && <span className="text-[11px] tabular-nums">{activeCount}</span>}
				</Button>
			</PopoverTrigger>
			<PopoverContent align="start" className="w-56 gap-1 p-1.5">
				<div className="px-2 pt-1 pb-0.5 text-[11px] font-medium text-muted-foreground/60">{t("filter.type")}</div>
				{TYPE_ORDER.map((type) => {
					const checked = filter.types.includes(type);
					const count = counts[type];
					return (
						<button
							key={type}
							type="button"
							role="checkbox"
							aria-checked={checked}
							disabled={count === 0 && !checked}
							onClick={() => toggleType(type)}
							className="flex h-7 items-center gap-2 rounded-md px-2 text-[12px] text-foreground transition-colors hover:bg-accent disabled:pointer-events-none disabled:opacity-40"
						>
							<span
								className={cn(
									"h-3.5 w-3.5 shrink-0",
									checked ? "icon-[solar--check-square-bold] text-primary" : "icon-[solar--stop-linear] text-muted-foreground/50",
								)}
							/>
							<span className="flex-1 text-left">{t(`type.${type}`)}</span>
							<span className="text-[11px] tabular-nums text-muted-foreground/50">{count}</span>
						</button>
					);
				})}
				{showProvenance && (
					<>
						<div className="mx-2 my-1 h-px bg-border/60" />
						<div className="px-2 pt-1 pb-0.5 text-[11px] font-medium text-muted-foreground/60">
							{t("filter.provenance")}
						</div>
						<div role="radiogroup" aria-label={t("filter.provenance")} className="flex gap-1 px-1.5 pb-1">
							{PROVENANCE_ORDER.map((provenance) => (
								<button
									key={provenance}
									type="button"
									role="radio"
									aria-checked={filter.provenance === provenance}
									onClick={() => onChange({ ...filter, provenance })}
									className={cn(
										"h-6 flex-1 rounded-md text-[11px] transition-colors",
										filter.provenance === provenance
											? "bg-accent font-medium text-foreground"
											: "text-muted-foreground hover:bg-accent/60",
									)}
								>
									{t(`filter.provenanceOption.${provenance}`)}
								</button>
							))}
						</div>
					</>
				)}
				<div className="mx-2 my-1 h-px bg-border/60" />
				<button
					type="button"
					disabled={activeCount === 0}
					onClick={() => onChange(EMPTY_ABILITY_FILTER)}
					className="flex h-7 items-center rounded-md px-2 text-[12px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
				>
					{t("filter.reset")}
				</button>
			</PopoverContent>
		</Popover>
	);
}
