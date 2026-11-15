import { cn } from "@astravia-org/ui/utils";
import { useEffect, useRef, useState } from "react";
import {
	ADD_PANEL_CATEGORY_ICONS,
	ADD_PANEL_CATEGORY_ORDER,
	ADD_PANEL_OPERATION_ICON,
	type AddPanelCategory,
	type AddPanelTab,
} from "./add-panel-catalog";
import type { CommandPanelLabels } from "./types";

/**
 * 左栏分类轨道。
 *
 * 五类**始终在轨道上**（外加收藏与「操作」）：位置固定是这套导航的全部意义，某一类暂时
 * 没有条目时由内容区显示空态，而不是把这格藏起来——藏起来会让同一类在两次打开之间换
 * 位置，用户又要重新找。图标在 16px 下必须彼此可辨（见 `ADD_PANEL_CATEGORY_ICONS`）。
 *
 * 轨道在窗口较矮时会超出可用高度。触控板能两指滑，但台式机与不带触控板的笔记本只能拖
 * 那条被藏起来的滚动条，所以两端各有一个**常显**的上下切换格：与其它格同样的尺寸、间距
 * 与配色，点一下走一格（不是滚一屏——逐个切换才看得见走到哪）。
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
	const listRef = useRef<HTMLDivElement>(null);
	const [more, setMore] = useState({ up: false, down: false });

	const sync = (): void => {
		const el = listRef.current;
		if (!el) return;
		const up = el.scrollTop > 1;
		const down = el.scrollTop + el.clientHeight < el.scrollHeight - 1;
		setMore((previous) => (previous.up === up && previous.down === down ? previous : { up, down }));
	};

	useEffect(() => {
		const el = listRef.current;
		if (!el) return;
		sync();
		el.addEventListener("scroll", sync, { passive: true });
		const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(sync);
		observer?.observe(el);
		return () => {
			el.removeEventListener("scroll", sync);
			observer?.disconnect();
		};
	}, []);

	/** 走一格：格子高 32 + 间距 4。到底/到顶时禁用而不是隐藏，位置不跳。 */
	const step = (direction: -1 | 1): void => {
		const el = listRef.current;
		if (!el) return;
		el.scrollBy({ top: direction * 36, behavior: "smooth" });
	};

	const item = (
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
					active && "bg-foreground/12 text-foreground",
					options.favorite && active && "text-amber-400",
				)}
			>
				<span aria-hidden="true" className={cn(icon, "size-4")} />
			</button>
		);
	};

	const categories: readonly AddPanelCategory[] = ADD_PANEL_CATEGORY_ORDER;

	return (
		/*
		 * 边框挂在最外层：它要一直画到面板底部，与快捷键行那条横向分隔线**相交**。
		 * 挂在内层滚动容器上会在容器底部提前收线，交点处出现缺口。
		 */
		<div className="flex min-h-0 w-11 shrink-0 flex-col self-stretch border-r border-border/30">
			{onOpenAbilityPlaza && (
				<div className="flex shrink-0 justify-center pb-1 pt-2">
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

			<RailStepButton
				direction="up"
				label={labels.hints.scrollRailUp}
				disabled={!more.up}
				onClick={() => step(-1)}
			/>

			<div
				ref={listRef}
				role="tablist"
				aria-label={labels.categories}
				className="no-scrollbar flex min-h-0 flex-1 flex-col items-center gap-1 overflow-y-auto"
			>
				{item("favorites", "icon-[solar--star-linear]", labels.favorites, { favorite: true })}
				{categories.map((category) =>
					item(category, ADD_PANEL_CATEGORY_ICONS[category], labels.categoryLabel(category)),
				)}
				{/* 操作（压缩上下文等）：与分类同一条轨道、同一档图标，靠间距分开而不是画线。 */}
				<div aria-hidden="true" className="h-1.5 shrink-0" />
				{item("operations", ADD_PANEL_OPERATION_ICON, labels.operations)}
			</div>

			<RailStepButton
				direction="down"
				label={labels.hints.scrollRailDown}
				disabled={!more.down}
				onClick={() => step(1)}
			/>
		</div>
	);
}

/**
 * 轨道的上下切换格。
 *
 * **常显**：无触控板的用户只能靠它，隐藏掉就等于没有。到顶/到底时只降到半透明表示
 * 「这个方向没有了」，位置与尺寸不变；配色与相邻分类格同一档，不额外弱化。
 * 图标用单箭头（与工具行同一套 `alt-arrow-*`），不用双箭头。
 */
function RailStepButton({
	direction,
	label,
	disabled,
	onClick,
}: {
	readonly direction: "up" | "down";
	readonly label: string;
	readonly disabled: boolean;
	readonly onClick: () => void;
}): JSX.Element {
	return (
		<button
			type="button"
			aria-label={label}
			title={label}
			disabled={disabled}
			onClick={onClick}
			className={cn(
				"mx-auto mb-0.5 mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors",
				disabled ? "cursor-default opacity-40" : "hover:bg-foreground/8 hover:text-foreground",
			)}
		>
			<span
				aria-hidden="true"
				className={cn(
					"size-4",
					direction === "up" ? "icon-[solar--alt-arrow-up-linear]" : "icon-[solar--alt-arrow-down-linear]",
				)}
			/>
		</button>
	);
}
