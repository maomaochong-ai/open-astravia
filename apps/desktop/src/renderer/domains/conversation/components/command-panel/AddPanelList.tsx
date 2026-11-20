import { cn } from "@astravia-org/ui/utils";
import {
	type AddPanelEntry,
	type AddPanelSection,
	type AddPanelTab,
	buildAddPanelRows,
} from "./add-panel-catalog";
import { AddPanelIcon } from "./AddPanelIcon";
import { ContextRingView } from "@astravia-org/theme-ui/chat/ContextRingView";
import type { CommandPanelLabels, CommandPanelOperationItem } from "./types";

/**
 * 条目行。
 *
 * 一条行 = 圆角容器 + 圆角图标底 + 名字 + 行尾两个图标（详情、星标）。行与行之间留
 * 2px 间距（`gap`），否则相邻两行的圆角贴在一起，看起来像一块没切开的长条。
 *
 * **默认没有选中行**：这里的列表不是「当前值」（不像模型选择器必须显示现在是哪个模型），
 * 它只是一批可点的东西。默认给某一行上选中底会被读成「这个已经选好了」，而且每次
 * hover 换行都像在列表里移动焦点。选中只由键盘产生。
 */
function EntryRow({
	entry,
	active,
	favorite,
	labels,
	onActivate,
	onOpenPreview,
	onToggleFavorite,
}: {
	readonly entry: AddPanelEntry;
	readonly active: boolean;
	readonly favorite: boolean;
	readonly labels: CommandPanelLabels;
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
			onClick={onActivate}
			onKeyDown={(event) => {
				if (event.key === "Enter" || event.key === " ") {
					event.preventDefault();
					onActivate();
				}
			}}
			className={cn(
				"group/entry flex h-8 cursor-pointer items-center gap-2 rounded-md px-1.5 transition-colors",
				active ? "bg-foreground/12 text-foreground" : "text-foreground/85 hover:bg-foreground/6 hover:text-foreground",
			)}
		>
			<AddPanelIcon
				icon={entry.icon}
				iconUrl={entry.iconUrl}
				fallbackIcon={entry.fallbackIcon}
				type={entry.kind}
				// 24px 方框按能力页 40px/rounded-xl 的比例取圆角，别用 `rounded`（4px 看起来仍是直角）。
				boxClassName="size-6 rounded-md bg-foreground/6"
				className="size-3.5"
			/>

			<span className={cn("min-w-0 flex-1 truncate text-xs", active && "font-medium")}>{entry.label}</span>

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
				// 一直挂着、只切透明度：`hidden` ↔ `inline-flex` 会在 hover 时改变行内宽度，
				// 文字被挤动一次，看起来就像「悬停时长出一个框」。同时显式去掉描边与轮廓，
				// 避免图标类没解析出来时露出一个带边框的空方块。
				className="inline-flex size-5 shrink-0 items-center justify-center rounded border-0 text-muted-foreground opacity-0 outline-none transition-opacity focus-visible:opacity-100 hover:bg-foreground/10 hover:text-foreground group-hover/entry:opacity-100 group-focus-within/entry:opacity-100"
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
					"inline-flex size-5 shrink-0 items-center justify-center rounded border-0 outline-none transition-opacity hover:bg-foreground/10",
					// 同上：常驻占位、只切透明度，收藏后无需 hover 也一直可见。
					favorite
						? "text-amber-400 opacity-100"
						: "text-muted-foreground opacity-0 group-hover/entry:opacity-100 group-focus-within/entry:opacity-100",
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
 * **不做虚拟化**：这层列表的行数上限是「一个会话能用的技能 + 文件动作」，实测上百行，
 * 全量渲染也就几百个轻节点；而窗口化要自己维护 scrollTop、占位高度与锚点，分组头再
 * 参与高度计算，稍有偏差就表现为「列表自己来回跳」——代价远大于收益。真正的长列表
 * （模型目录可能几千条）仍由模型选择器那套窗口化处理。
 *
 * 分组头不显示计数，也不画横线：层次靠字号、明度与间距拉开。
 */
export function AddPanelList({
	sections,
	activeKey,
	scrollSignal,
	favorites,
	labels,
	searching,
	tabKey,
	limit,
	operation,
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
	/** 当前分类：仅用于列表重置滚动位置（换分类必须回到顶部）。 */
	readonly tabKey: AddPanelTab;
	/** 本次最多渲染多少行（揭幕动画期间用，避免首帧同步布局上百行）。 */
	readonly limit?: number;
	/** 「操作」分类里的会话操作（压缩上下文），作为列表里的一行渲染。 */
	readonly operation?: CommandPanelOperationItem;
	readonly onActivateEntry: (key: string) => void;
	readonly onOpenPreview: (key: string) => void;
	readonly onToggleFavorite: (key: string) => void;
}): JSX.Element {
	const allRows = buildAddPanelRows(sections, {
		searching,
		categoryLabel: labels.categoryLabel,
		groupLabel: labels.groupLabel,
	});
	/*
	 * `limit` 只裁「首帧要布局多少行」：揭幕动画期间铺十几行就够填满可视区，
	 * 动画结束后一次性补齐。裁的是渲染，不是数据——键盘索引仍按全量算。
	 */
	const rows = limit === undefined ? allRows : allRows.slice(0, limit);
	const favoriteKeys = new Set(favorites);

	return (
		<div
			role="listbox"
			aria-label={labels.searchPlaceholder}
			data-add-panel-list=""
			className="no-scrollbar min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-1.5 pb-2"
			// 换分类/改搜索词时回到顶部：否则沿用上一类的 scrollTop，看起来像「点完又跳回去」。
			key={`list:${labels.categoryLabel(tabKey)}:${searching ? "search" : "browse"}`}
			// 键盘选中时把高亮行带进视口。用容器的 scrollIntoView（block: nearest）而不是自己
			// 算 scrollTop：列表不做虚拟化，节点一直在，交给浏览器算最可靠，也不会连累外层。
			ref={(node) => {
				if (!node || scrollSignal === 0 || !activeKey) return;
				// 只滚这个容器自己：`scrollIntoView` 会连带滚动外层（会话页、侧栏），
				// 表现就是整块界面跟着跳。
				const row = node.querySelector<HTMLElement>(`[data-entry-key="${activeKey}"]`);
				if (!row) return;
				const containerRect = node.getBoundingClientRect();
				const rowRect = row.getBoundingClientRect();
				if (rowRect.top < containerRect.top) node.scrollTop -= containerRect.top - rowRect.top;
				else if (rowRect.bottom > containerRect.bottom) node.scrollTop += rowRect.bottom - containerRect.bottom;
			}}
		>
			<div className="flex flex-col gap-0.5">
				{operation && (
					<button
						type="button"
						data-entry-key="__operation__"
						aria-selected={activeKey === "__operation__"}
						disabled={operation.disabled}
						onClick={operation.onSelect}
						className={cn(
							"flex h-8 items-center gap-2 rounded-md px-1.5 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50",
							activeKey === "__operation__" ? "bg-foreground/12" : "hover:bg-foreground/6",
						)}
					>
						<span className="flex size-6 shrink-0 items-center justify-center rounded bg-foreground/6">
							{operation.contextRing ? (
								<ContextRingView {...operation.contextRing} className="pointer-events-none" />
							) : (
								<span aria-hidden="true" className="size-3.5 rounded-full border border-border" />
							)}
						</span>
						<span className="min-w-0 flex-1 truncate text-xs">{operation.label}</span>
						<span className="max-w-[55%] shrink-0 truncate text-[10px] text-muted-foreground/70">
							{operation.description}
						</span>
					</button>
				)}
				{rows.map((row) =>
					row.kind === "header" ? (
						<p
							key={row.id}
							className="flex items-baseline gap-1 px-2 pb-0.5 pt-2 text-[10px] font-medium tracking-wide text-muted-foreground/60"
						>
							<span className="truncate">{row.label}</span>
							<span className="shrink-0 tabular-nums text-muted-foreground/40">{row.count}</span>
						</p>
					) : (
						<EntryRow
							key={row.entry.key}
							entry={row.entry}
							active={row.entry.key === activeKey}
							favorite={favoriteKeys.has(row.entry.key)}
							labels={labels}
							onActivate={() => onActivateEntry(row.entry.key)}
							onOpenPreview={() => onOpenPreview(row.entry.key)}
							onToggleFavorite={() => onToggleFavorite(row.entry.key)}
						/>
					),
				)}
			</div>
		</div>
	);
}
