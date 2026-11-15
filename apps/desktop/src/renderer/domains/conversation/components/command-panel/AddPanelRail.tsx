import { cn } from "@astravia-org/ui/utils";
import { type AddPanelCategory, ADD_PANEL_CATEGORY_ICONS, type AddPanelTab } from "./add-panel-catalog";
import type { CommandPanelLabels } from "./types";

/**
 * 左栏分类轨道。
 *
 * 只渲染**真有条目**的分类（由 `categories` 传入）：插件与应用当前拿不到数据，
 * 多两个点不动的图标等于骗用户「这里有东西」。收藏常驻第一格。
 *
 * 每格只有图标，名字走原生 `title`——列表宽度要留给条目名，而「现在在哪一类」
 * 由选中态表达，不需要文字重复一遍。
 */
export function AddPanelRail({
	tab,
	categories,
	labels,
	onSelectTab,
	onOpenAbilityPlaza,
}: {
	readonly tab: AddPanelTab;
	readonly categories: readonly AddPanelCategory[];
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
					"flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-foreground/8 hover:text-foreground",
					active && "bg-foreground/10 text-foreground",
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
			{categories.length > 0 && <div aria-hidden="true" className="my-1 h-px w-5 shrink-0 bg-border/50" />}
			{categories.map((category) =>
				button(category, ADD_PANEL_CATEGORY_ICONS[category], labels.categoryLabel(category)),
			)}
			{onOpenAbilityPlaza && (
				<div className="mt-auto pt-1">
					<button
						type="button"
						aria-label={labels.openAbilityPlaza}
						title={labels.openAbilityPlaza}
						onClick={onOpenAbilityPlaza}
						className="flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-foreground/8 hover:text-foreground"
					>
						<span aria-hidden="true" className="icon-[solar--slider-horizontal-linear] size-4" />
					</button>
				</div>
			)}
		</div>
	);
}
