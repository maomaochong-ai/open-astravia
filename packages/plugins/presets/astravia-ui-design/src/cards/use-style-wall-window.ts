/**
 * 风格墙的按行窗口化：把「这一帧该渲染哪几行」这件事打包成 hook。
 *
 * 会话页的风格库和设计页的风格库是同一面墙，只是列数与行距不同，所以逻辑只写一遍：
 *
 * - 宽度用 `ResizeObserver` 实测，列数与行高按实测宽度换算——这一区跟着窗口伸缩，用错的
 *   行高做窗口换算会让卡片在滚动中错位。
 * - 滚动的是宿主页面（或设计页里那个 `overflow-y-auto` 容器），插件够不着它，所以在
 *   window 上挂捕获阶段监听，收所有祖先的滚动事件；位置一律用 rect 相对视口重算。
 * - 事件合到下一帧处理，且窗口没变就不 setState，否则每个滚动事件都要把整面墙重渲一次。
 * - 上下空出来的行用 padding 撑开而不是占位元素：网格里插占位会把后面的卡挤错列。
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
	type StyleGridMetrics,
	type StyleGridOptions,
	styleGridMetrics,
	styleGridWindow,
} from "./style-wall-layout";

export interface UseStyleWallWindowOptions extends StyleGridOptions {
	readonly total: number;
}

export interface StyleWallWindow {
	/** 挂到被测量（也是被撑开）的网格容器上。 */
	readonly ref: (node: HTMLDivElement | null) => void;
	readonly metrics: StyleGridMetrics;
	/** 当前该渲染的区间，直接 `items.slice(start, end)`。 */
	readonly start: number;
	readonly end: number;
	readonly paddingTop: number;
	readonly paddingBottom: number;
}

interface VisibleBand {
	readonly scrolledPast: number;
	readonly viewportHeight: number;
}

/** 视口里真正露给这面墙的高度：窗口与被裁剪祖先取交集。 */
function measureBand(node: HTMLElement, scroller: HTMLElement | null): VisibleBand {
	const rect = node.getBoundingClientRect();
	let top = 0;
	let bottom = window.innerHeight;
	if (scroller) {
		const box = scroller.getBoundingClientRect();
		top = Math.max(top, box.top);
		bottom = Math.min(bottom, box.bottom);
	}
	return { scrolledPast: top - rect.top, viewportHeight: Math.max(0, bottom - top) };
}

/** 最近的纵向滚动容器；没有就交给窗口。只在挂载/尺寸变化时算一次。 */
function findScrollParent(node: HTMLElement): HTMLElement | null {
	for (let element = node.parentElement; element; element = element.parentElement) {
		const { overflowY } = getComputedStyle(element);
		if (overflowY === "auto" || overflowY === "scroll") return element;
	}
	return null;
}

export function useStyleWallWindow(options: UseStyleWallWindowOptions): StyleWallWindow {
	const { total } = options;
	const { gap, maxColumns, minCardWidth } = options;
	const [node, setNode] = useState<HTMLDivElement | null>(null);
	const [width, setWidth] = useState(0);
	const [range, setRange] = useState({ start: 0, end: total });
	/** 上一次算出的窗口：窗口没变就不进 React，滚动才不会每帧重渲。 */
	const rangeRef = useRef(range);
	const scrollerRef = useRef<HTMLElement | null>(null);
	const frameRef = useRef(0);

	const ref = useCallback((next: HTMLDivElement | null) => {
		setNode(next);
	}, []);

	// 列数与行高都从实测宽度换算。宽度按 grid 容器的内容宽，所以容器自身只许有纵向 padding。
	const metrics = useMemo(
		() => styleGridMetrics(width, { gap, maxColumns, minCardWidth }),
		[gap, maxColumns, minCardWidth, width],
	);

	useLayoutEffect(() => {
		if (!node) return;
		scrollerRef.current = findScrollParent(node);
		const measure = () => setWidth(node.clientWidth);
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(node);
		return () => observer.disconnect();
	}, [node]);

	const syncRange = useCallback(() => {
		if (!node || metrics.rowHeight <= 0) return;
		const next = styleGridWindow({
			...measureBand(node, scrollerRef.current),
			metrics,
			total,
		});
		const current = rangeRef.current;
		if (next.start === current.start && next.end === current.end) return;
		rangeRef.current = next;
		setRange(next);
	}, [metrics, node, total]);

	useEffect(() => {
		const onScroll = () => {
			if (frameRef.current) return;
			frameRef.current = requestAnimationFrame(() => {
				frameRef.current = 0;
				syncRange();
			});
		};
		syncRange();
		window.addEventListener("scroll", onScroll, { capture: true, passive: true });
		window.addEventListener("resize", onScroll, { passive: true });
		return () => {
			window.removeEventListener("scroll", onScroll, { capture: true });
			window.removeEventListener("resize", onScroll);
			if (frameRef.current) cancelAnimationFrame(frameRef.current);
			frameRef.current = 0;
		};
	}, [syncRange]);

	const { columns, rowHeight } = metrics;
	const rowCount = Math.ceil(total / columns);
	// 还没量出行高时先整份铺上：这一帧算不出窗口，宁可多画也不能留白一屏。
	const windowed = rowHeight > 0;
	const start = windowed ? Math.min(range.start, Math.max(0, (rowCount - 1) * columns)) : 0;
	const end = windowed ? Math.min(total, Math.max(range.end, start + columns)) : total;
	const leadingRows = Math.floor(start / columns);
	const trailingRows = Math.max(0, rowCount - Math.ceil(end / columns));

	return {
		ref,
		metrics,
		start,
		end,
		paddingTop: windowed ? leadingRows * rowHeight : 0,
		paddingBottom: windowed ? trailingRows * rowHeight : 0,
	};
}
