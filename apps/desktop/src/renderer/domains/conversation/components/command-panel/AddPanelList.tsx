import { cn } from "@astravia-org/ui/utils";
import { useEffect, useRef, useState } from "react";
import {
	type AddPanelEntry,
	type AddPanelSection,
	computeAddPanelWindow,
	flattenAddPanelSections,
} from "./add-panel-catalog";
import type { CommandPanelLabels } from "./types";

/** 行高与窗口化阈值：与模型选择器同一组取值，行高固定才能按下标算窗口。 */
const ROW_HEIGHT = 28;
const HEADER_HEIGHT = 22;
export const ADD_PANEL_LIST_HEIGHT = 268;

/**
 * 条目行。
 *
 * 行上只有名字，描述与来源都在右栏——「按名字找东西」时它们只是噪音，还会把
 * 每行撑到 32px 以上，一屏少看两三行。星标与详情在悬停/高亮时才出现，
 * 已收藏的星标常亮：它是持久状态，不能悬停才看得见。
 */
function EntryRow({
	entry,
	active,
	favorite,
	labels,
	onHover,
	onActivate,
	onToggleFavorite,
}: {
	readonly entry: AddPanelEntry;
	readonly active: boolean;
	readonly favorite: boolean;
	readonly labels: CommandPanelLabels;
	readonly onHover: () => void;
	readonly onActivate: () => void;
	readonly onToggleFavorite: () => void;
}): JSX.Element {
	return (
		<div
			role="option"
			aria-selected={active}
			data-entry-key={entry.key}
			onMouseEnter={onHover}
			onMouseDown={(event) => event.preventDefault()}
			className={cn(
				"group/entry relative flex h-7 items-center gap-2 rounded-md px-2 transition-colors",
				active ? "bg-accent" : "hover:bg-foreground/5",
			)}
		>
			<button
				type="button"
				tabIndex={-1}
				onClick={onActivate}
				title={entry.description || entry.label}
				className="min-w-0 flex-1 truncate text-left text-xs text-foreground outline-none"
			>
				{entry.label}
			</button>
			{/* 顺序固定：详情在左、收藏在最右。收藏是行尾的持久状态，放最右才不随悬停位移。 */}
			<button
				type="button"
				tabIndex={-1}
				aria-label={labels.details}
				title={labels.details}
				onClick={onHover}
				className="hidden size-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-foreground/10 hover:text-foreground group-hover/entry:inline-flex group-focus-within/entry:inline-flex"
			>
				<span aria-hidden="true" className="icon-[solar--info-circle-linear] size-3" />
			</button>
			<button
				type="button"
				tabIndex={-1}
				aria-label={favorite ? labels.favoriteRemove : labels.favoriteAdd}
				aria-pressed={favorite}
				title={favorite ? labels.favoriteRemove : labels.favoriteAdd}
				onClick={onToggleFavorite}
				className={cn(
					"size-5 shrink-0 items-center justify-center rounded hover:bg-foreground/10",
					favorite
						? "inline-flex text-amber-400"
						: "hidden text-muted-foreground group-hover/entry:inline-flex group-focus-within/entry:inline-flex",
					active && !favorite && "inline-flex",
				)}
			>
				<span
					aria-hidden="true"
					className={cn("size-3.5", favorite ? "icon-[solar--star-bold]" : "icon-[solar--star-linear]")}
				/>
			</button>
		</div>
	);
}

/**
 * 中栏列表：分组头 + 条目。
 *
 * 分组头不显示计数——每次切换分类都在跳的数字没有决策价值。分类只有一个分组时
 * 不显示分组头（那时它与分类名重复）；搜索态按分类分组，标题就是分类名。
 */
export function AddPanelList({
	sections,
	activeKey,
	favorites,
	labels,
	searching,
	onHoverEntry,
	onActivateEntry,
	onToggleFavorite,
}: {
	readonly sections: readonly AddPanelSection[];
	readonly activeKey: string | null;
	readonly favorites: readonly string[];
	readonly labels: CommandPanelLabels;
	readonly searching: boolean;
	readonly onHoverEntry: (key: string) => void;
	readonly onActivateEntry: (key: string) => void;
	readonly onToggleFavorite: (key: string) => void;
}): JSX.Element {
	const listRef = useRef<HTMLDivElement>(null);
	const [scrollTop, setScrollTop] = useState(0);
	const [fading, setFading] = useState({ top: false, bottom: false });
	const entries = flattenAddPanelSections(sections);
	const favoriteKeys = new Set(favorites);

	const window = computeAddPanelWindow({
		entries,
		rowHeight: ROW_HEIGHT,
		viewportHeight: ADD_PANEL_LIST_HEIGHT,
		scrollTop,
	});
	const visibleKeys = new Set(window.entries.map((entry) => entry.key));

	// 高亮项变了就把它滚进视口：键盘上下移动时列表要跟着走。
	// 直接算滚动量而不是 scrollIntoView——后者在 jsdom 里没有实现，且会连带滚动外层容器。
	useEffect(() => {
		const list = listRef.current;
		const node = list?.querySelector<HTMLElement>(`[data-entry-key="${activeKey ?? ""}"]`);
		if (!list || !node) return;
		const top = node.offsetTop;
		const bottom = top + node.offsetHeight;
		if (top < list.scrollTop) list.scrollTop = top;
		else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight;
	}, [activeKey]);

	useEffect(() => {
		const el = listRef.current;
		if (!el) return;
		const sync = (): void => {
			const top = el.scrollTop > 1;
			const bottom = el.scrollTop + el.clientHeight < el.scrollHeight - 1;
			setFading((previous) => (previous.top === top && previous.bottom === bottom ? previous : { top, bottom }));
		};
		sync();
		el.addEventListener("scroll", sync, { passive: true });
		const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(sync);
		observer?.observe(el);
		return () => {
			el.removeEventListener("scroll", sync);
			observer?.disconnect();
		};
	}, []);

	const mask =
		fading.top || fading.bottom
			? `linear-gradient(to bottom, ${fading.top ? "transparent 0, #000 14px" : "#000 0"}, ${
					fading.bottom ? "#000 calc(100% - 14px), transparent 100%" : "#000 100%"
				})`
			: undefined;

	return (
		<div
			ref={listRef}
			role="listbox"
			aria-label={labels.searchPlaceholder}
			onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
			className="no-scrollbar min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-1 pb-1"
			style={{ maxHeight: ADD_PANEL_LIST_HEIGHT, maskImage: mask, WebkitMaskImage: mask }}
		>
			{window.paddingTop > 0 && <div style={{ height: window.paddingTop }} aria-hidden="true" />}
			{sections.map((section) => {
				// 搜索态按分类分组，标题是分类名；分类视图里按来源分组，来源多于一个才出标题。
				const showCategoryHeader = searching;
				const showGroupHeaders = !searching && section.groups.length > 1;
				return (
					<div key={section.category}>
						{showCategoryHeader && (
							<p className="px-2 pb-0.5 pt-1.5 text-[10px] font-medium text-muted-foreground/60">
								{labels.categoryLabel(section.category)}
							</p>
						)}
						{section.groups.map((group) => {
							const rendered = group.entries.filter((entry) => visibleKeys.has(entry.key));
							if (rendered.length === 0) return null;
							return (
								<div key={group.id}>
									{showGroupHeaders && (
										<p className="px-2 pb-0.5 pt-1.5 text-[10px] font-medium text-muted-foreground/60">
											{labels.groupLabel(group.titleKey)}
										</p>
									)}
									{rendered.map((entry) => (
										<EntryRow
											key={entry.key}
											entry={entry}
											active={entry.key === activeKey}
											favorite={favoriteKeys.has(entry.key)}
											labels={labels}
											onHover={() => onHoverEntry(entry.key)}
											onActivate={() => onActivateEntry(entry.key)}
											onToggleFavorite={() => onToggleFavorite(entry.key)}
										/>
									))}
								</div>
							);
						})}
					</div>
				);
			})}
			{window.paddingBottom > 0 && <div style={{ height: window.paddingBottom }} aria-hidden="true" />}
		</div>
	);
}
