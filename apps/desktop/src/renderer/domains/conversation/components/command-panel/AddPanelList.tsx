import { cn } from "@astravia-org/ui/utils";
import { useEffect, useRef, useState } from "react";
import {
	type AddPanelEntry,
	type AddPanelSection,
	computeAddPanelWindow,
	flattenAddPanelSections,
} from "./add-panel-catalog";
import type { CommandPanelLabels } from "./types";

/** 行高与窗口化阈值：与模型选择器同一组取值（ADR-0159 §5、ADR-0175 §8）。 */
const ROW_HEIGHT = 32;
export const ADD_PANEL_LIST_HEIGHT = 272;

/**
 * 条目行：分类图标 + 名字 + 行尾两个图标（详情、星标）。
 *
 * 行上不放描述与来源——「按名字找东西」时它们只是噪音，还会把每行撑到 36px 以上。
 * 想看清楚是什么，点行尾的「详情」进预览页。
 *
 * 整行是插入目标（点击 = 插入 / 执行），所以行是一个可点容器而不是 `<button>`：
 * 行内还有两个按钮，嵌套 button 在 HTML 里不合法。
 */
function EntryRow({
	entry,
	active,
	favorite,
	labels,
	onHover,
	onActivate,
	onOpenPreview,
	onToggleFavorite,
}: {
	readonly entry: AddPanelEntry;
	readonly active: boolean;
	readonly favorite: boolean;
	readonly labels: CommandPanelLabels;
	readonly onHover: () => void;
	readonly onActivate: () => void;
	readonly onOpenPreview: () => void;
	readonly onToggleFavorite: () => void;
}): JSX.Element {
	return (
		<div
			role="option"
			aria-selected={active}
			tabIndex={-1}
			data-entry-key={entry.key}
			onMouseEnter={onHover}
			onClick={onActivate}
			onKeyDown={(event) => {
				if (event.key === "Enter" || event.key === " ") {
					event.preventDefault();
					onActivate();
				}
			}}
			className={cn(
				"group/entry relative flex h-8 cursor-pointer items-center gap-2 rounded-md px-2 transition-colors",
				active ? "bg-primary/15 text-foreground" : "text-foreground/90 hover:bg-foreground/8 hover:text-foreground",
			)}
		>
			{/* 高亮指示条：选中态与 hover 都要能一眼区分，光靠底色深浅在深色背景上不够。 */}
			{active && <span aria-hidden="true" className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-full bg-primary" />}

			<span className="flex size-4 shrink-0 items-center justify-center">
				{entry.iconUrl ? (
					<img src={entry.iconUrl} alt="" className="size-4 object-contain" draggable={false} />
				) : (
					<span aria-hidden="true" className={cn(entry.icon ?? entry.fallbackIcon, "size-3.5 text-muted-foreground")} />
				)}
			</span>

			<span className="min-w-0 flex-1 truncate text-xs">{entry.label}</span>

			{/* 顺序固定：详情在左、收藏在最右。收藏是行尾的持久状态，放最右才不随悬停位移。 */}
			<button
				type="button"
				tabIndex={-1}
				aria-label={labels.details}
				title={labels.details}
				onClick={(event) => {
					event.stopPropagation();
					onOpenPreview();
				}}
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
				onClick={(event) => {
					event.stopPropagation();
					onToggleFavorite();
				}}
				className={cn(
					"size-5 shrink-0 items-center justify-center rounded hover:bg-foreground/10",
					favorite
						? "inline-flex text-amber-400"
						: "hidden text-muted-foreground group-hover/entry:inline-flex group-focus-within/entry:inline-flex",
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
 * 分组头不显示计数——每次切换分类都在跳的数字没有决策价值。分类只有一个分组时不显示
 * 分组头（那时它与分类名重复）；搜索态按分类分组，标题就是分类名。
 */
export function AddPanelList({
	sections,
	activeKey,
	scrollSignal,
	favorites,
	labels,
	searching,
	onHoverEntry,
	onActivateEntry,
	onOpenPreview,
	onToggleFavorite,
}: {
	readonly sections: readonly AddPanelSection[];
	readonly activeKey: string | null;
	readonly scrollSignal: number;
	readonly favorites: readonly string[];
	readonly labels: CommandPanelLabels;
	readonly searching: boolean;
	readonly onHoverEntry: (key: string) => void;
	readonly onActivateEntry: (key: string) => void;
	readonly onOpenPreview: (key: string) => void;
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

	/**
	 * 只在**键盘**移动时把高亮行滚进视口。
	 *
	 * 以前依赖 `activeKey`，而 hover 也会改高亮：鼠标划过一行就触发一次自动滚动，
	 * 列表在指针底下自己往下跑（用户报的「自动向下滚动、没有固定」）。现在由
	 * `scrollSignal` 承载「这是键盘动作」，hover 只换底色、不动滚动位置。
	 *
	 * 位置用 rect 差值换算，不用 offsetTop：行外面还套着「分类 / 分组」两层无定位的
	 * div，offsetParent 会一路找到面板，offsetTop 含了头部与分组头的偏移。
	 */
	useEffect(() => {
		if (scrollSignal === 0) return;
		const list = listRef.current;
		const node = list?.querySelector<HTMLElement>(`[data-entry-key="${activeKey ?? ""}"]`);
		if (!list || !node) return;
		const listRect = list.getBoundingClientRect();
		const nodeRect = node.getBoundingClientRect();
		const top = nodeRect.top - listRect.top + list.scrollTop;
		const bottom = top + nodeRect.height;
		if (top < list.scrollTop) list.scrollTop = top;
		else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight;
		// eslint 不会再要求 activeKey：它只提供下标，滚动由 scrollSignal 触发
	}, [scrollSignal, activeKey]);

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
						{showCategoryHeader && <GroupHeader label={labels.categoryLabel(section.category)} first />}
						{section.groups.map((group, index) => {
							const rendered = group.entries.filter((entry) => visibleKeys.has(entry.key));
							if (rendered.length === 0) return null;
							return (
								<div key={group.id}>
									{showGroupHeaders && <GroupHeader label={labels.groupLabel(group.titleKey)} first={index === 0} />}
									{rendered.map((entry) => (
										<EntryRow
											key={entry.key}
											entry={entry}
											active={entry.key === activeKey}
											favorite={favoriteKeys.has(entry.key)}
											labels={labels}
											onHover={() => onHoverEntry(entry.key)}
											onActivate={() => onActivateEntry(entry.key)}
											onOpenPreview={() => onOpenPreview(entry.key)}
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

/**
 * 分组头。
 *
 * 层次靠三件事拉开，而不是靠加粗：与行之间多留 6px 上间距、字比行小一号、颜色比行淡。
 * 第一个分组头不再给自己加上间距（那会在搜索框下多出一条空带）。
 */
function GroupHeader({ label, first = false }: { readonly label: string; readonly first?: boolean }): JSX.Element {
	return (
		<p
			className={cn(
				"px-2 pb-1 text-[10px] font-medium tracking-wide text-muted-foreground/70",
				first ? "pt-1" : "pt-2.5",
			)}
		>
			{label}
		</p>
	);
}
