import { cn } from "@astravia-org/ui/utils";
import { ADD_PANEL_CATEGORY_ORDER, type AddPanelTab } from "./add-panel-catalog";
import type { CommandPanelLabels } from "./types";

const CATEGORY_ICONS: Record<Exclude<AddPanelTab, "favorites">, string> = {
	files: "icon-[solar--paperclip-linear]",
	skills: "icon-[solar--code-scan-bold-duotone]",
	connectors: "icon-[solar--plug-circle-linear]",
	plugins: "icon-[solar--widget-2-linear]",
	apps: "icon-[solar--widget-linear]",
};

/**
 * 左栏分类轨道。
 *
 * 五类的位置固定：同一类条目每次都出现在同一格，用户靠肌肉记忆点，不再随内容滚动。
 * 每格只有图标，名字走原生 `title`——列表宽度要留给条目名，而「现在在哪一类」
 * 由选中态表达，不需要文字重复一遍。
 */
export function AddPanelRail({
	tab,
	labels,
	onSelectTab,
	onOpenAbilityPlaza,
}: {
	readonly tab: AddPanelTab;
	readonly labels: CommandPanelLabels;
	readonly onSelectTab: (tab: AddPanelTab) => void;
	readonly onOpenAbilityPlaza?: () => void;
}): JSX.Element {
	const button = (
		key: AddPanelTab,
		icon: string,
		label: string,
		options: { readonly favorite?: boolean } = {},
	): JSX.Element => {
		const active = tab === key;
		return (
			<button
				key={key}
				type="button"
				role="tab"
				aria-selected={active}
				aria-label={label}
				title={label}
				onClick={() => onSelectTab(key)}
				className={cn(
					"flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground",
					active && "bg-accent text-foreground",
					options.favorite && active && "text-amber-400",
				)}
			>
				<span aria-hidden="true" className={cn(icon, "size-4")} />
			</button>
		);
	};

	return (
		<div
			role="tablist"
			aria-label={labels.categories}
			className="no-scrollbar flex w-11 shrink-0 flex-col items-center gap-0.5 overflow-y-auto border-r border-border/40 py-1.5"
		>
			{button("favorites", "icon-[solar--star-linear]", labels.favorites, { favorite: true })}
			<div aria-hidden="true" className="my-1 h-px w-5 shrink-0 bg-border/50" />
			{ADD_PANEL_CATEGORY_ORDER.map((category) =>
				button(category, CATEGORY_ICONS[category], labels.categoryLabel(category)),
			)}
			{onOpenAbilityPlaza && (
				<div className="mt-auto pt-1">
					<button
						type="button"
						aria-label={labels.openAbilityPlaza}
						title={labels.openAbilityPlaza}
						onClick={onOpenAbilityPlaza}
						className="flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
					>
						<span aria-hidden="true" className="icon-[solar--slider-horizontal-linear] size-4" />
					</button>
				</div>
			)}
		</div>
	);
}
