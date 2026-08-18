import { useCallback, useEffect, useRef, useState } from "react";
import { useQuickPanelTranslation } from "./i18n";
import { QUICK_PANEL_ITEM_HEIGHT, RecentItem } from "./RecentItem";
import type { QuickPanelItem } from "./useQuickPanelSessions";

/** 列表固定显示的可视项数；超过则滚动。 */
const VISIBLE_ITEMS = 5;
/** 滚动区固定高度 = 5 个 item 高度。 */
const LIST_VIEWPORT_HEIGHT = VISIBLE_ITEMS * QUICK_PANEL_ITEM_HEIGHT;
/** 渐隐遮罩高度（px）。 */
const FADE = 28;

/** 据滚动位置生成上/下边缘渐隐遮罩，提示「还有更多内容」（替代滚动条）。 */
function fadeMask(atTop: boolean, atBottom: boolean): string | undefined {
	if (atTop && atBottom) return undefined; // 无溢出，不遮罩
	const top = atTop ? "black 0" : `transparent 0, black ${FADE}px`;
	const bottom = atBottom ? "black 100%" : `black calc(100% - ${FADE}px), transparent 100%`;
	return `linear-gradient(to bottom, ${top}, ${bottom})`;
}

interface RecentListProps {
	items: QuickPanelItem[];
	/** 高亮行号：0 = 输入行，1..N = 列表项（items[highlight-1]）。 */
	highlight: number;
	onHover: (index: number) => void;
	onSelect: (item: QuickPanelItem) => void;
}

export function RecentList({ items, highlight, onHover, onSelect }: RecentListProps): JSX.Element {
	const t = useQuickPanelTranslation();
	const scrollRef = useRef<HTMLDivElement>(null);
	// 滚动区是否已到顶/到底，决定渐隐遮罩；初始 atBottom=true 表示「未溢出」。
	const [edges, setEdges] = useState({ atTop: true, atBottom: true });

	const syncEdges = useCallback(() => {
		const el = scrollRef.current;
		if (!el) return;
		const atTop = el.scrollTop <= 1;
		const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 1;
		setEdges((prev) => (prev.atTop === atTop && prev.atBottom === atBottom ? prev : { atTop, atBottom }));
	}, []);

	// 列表项数量变化（含高亮自动滚动后）重算边缘状态。
	useEffect(() => {
		syncEdges();
	}, [syncEdges, items.length, highlight]);

	if (items.length === 0) {
		return (
			<div
				style={{ height: LIST_VIEWPORT_HEIGHT }}
				className="flex flex-col items-center justify-center gap-2 px-6 text-center"
			>
				<span className="icon-[solar--chat-round-line-linear] h-8 w-8 text-muted-foreground/40" />
				<p className="text-[13px] text-foreground">{t("emptyTitle")}</p>
				<p className="text-[12px] text-muted-foreground">{t("emptyHint")}</p>
			</div>
		);
	}

	return (
		<div className="flex flex-col">
			<p className="px-3.5 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground/70">
				{t("recentTitle")}
			</p>
			{/* 固定 5 个 item 高度的滚动区；上下键移动高亮，活动项自动滚入。
			    无滚动条，改用上/下边缘渐隐遮罩提示可滚动。 */}
			<div
				ref={scrollRef}
				onScroll={syncEdges}
				className="quickpanel-scroll overflow-y-auto px-2 pb-2"
				style={{
					height: LIST_VIEWPORT_HEIGHT,
					WebkitMaskImage: fadeMask(edges.atTop, edges.atBottom),
					maskImage: fadeMask(edges.atTop, edges.atBottom),
				}}
			>
				{items.map((item, index) => (
					<RecentItem
						key={item.sessionPath}
						item={item}
						active={highlight === index + 1}
						onMouseEnter={() => onHover(index)}
						onClick={() => onSelect(item)}
					/>
				))}
			</div>
		</div>
	);
}
