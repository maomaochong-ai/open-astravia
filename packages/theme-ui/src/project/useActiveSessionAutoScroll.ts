import { type RefObject, useEffect, useRef } from "react";
import type { VirtuosoHandle } from "react-virtuoso";
import { VIRTUAL_SESSION_ROW_HEIGHT } from "./types";

const SAFE_ZONE_TOP_RATIO = 1 / 3;
const SAFE_ZONE_BOTTOM_RATIO = 2 / 3;
const MIN_SCROLL_RANGE = VIRTUAL_SESSION_ROW_HEIGHT;
const MIN_SCROLL_DELTA = VIRTUAL_SESSION_ROW_HEIGHT / 2;
const LAYOUT_SETTLE_DELAY_MS = 370;

type ScrollAdjustment = "moved" | "stable" | "unavailable";

interface ActiveSessionAutoScrollOptions {
	activeIndex: number;
	activeKey: string | undefined;
	enabled?: boolean;
	scrollParent: HTMLElement | null;
	virtuosoRef: RefObject<VirtuosoHandle | null>;
}

interface ExpandedProjectAutoScrollOptions {
	expanded: boolean;
	projectRowRef: RefObject<HTMLElement | null>;
	scrollParent: HTMLElement | null;
}

function prefersReducedMotion(): boolean {
	return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function hasUsefulScrollRange(scrollParent: HTMLElement): boolean {
	return scrollParent.scrollHeight - scrollParent.clientHeight > MIN_SCROLL_RANGE;
}

function scrollElementIntoSafeZone(scrollParent: HTMLElement, element: HTMLElement): ScrollAdjustment {
	if (!hasUsefulScrollRange(scrollParent)) return "unavailable";
	const containerRect = scrollParent.getBoundingClientRect();
	const rowRect = element.getBoundingClientRect();
	const viewportHeight = containerRect.height;
	const rowCenter = rowRect.top - containerRect.top + rowRect.height / 2;
	const safeTop = viewportHeight * SAFE_ZONE_TOP_RATIO;
	const safeBottom = viewportHeight * SAFE_ZONE_BOTTOM_RATIO;
	if (rowCenter >= safeTop && rowCenter <= safeBottom) return "stable";

	const delta = rowCenter - safeTop;
	if (Math.abs(delta) <= MIN_SCROLL_DELTA) return "stable";

	const maxScrollTop = Math.max(0, scrollParent.scrollHeight - scrollParent.clientHeight);
	const targetTop = Math.min(maxScrollTop, Math.max(0, scrollParent.scrollTop + delta));
	if (Math.abs(targetTop - scrollParent.scrollTop) <= MIN_SCROLL_DELTA) return "stable";

	scrollParent.scrollTo({
		top: targetTop,
		behavior: prefersReducedMotion() ? "auto" : "smooth",
	});
	return "moved";
}

function scrollMountedActiveRow(scrollParent: HTMLElement): boolean {
	const activeRow = scrollParent.querySelector<HTMLElement>('[data-session-active="true"]');
	return activeRow ? scrollElementIntoSafeZone(scrollParent, activeRow) !== "unavailable" : false;
}

/**
 * 点击时把行滚进安全区。**不阻塞导航**：滚动动画和 `openSession` 并行跑。
 *
 * 这里原本会返回一个「等滚动结束」的 Promise，调用方 `Promise.all` 完它（再叠加一个
 * 「等面板 max-height 过渡结束」的 Promise）之后才发起会话切换，fallback 分别是 800ms
 * 与 450ms。于是点一个不在列表中间的会话，切换要先干等几百毫秒才开始——而 openSession
 * 内部本来已经做了「拿到 sessionId 就写 activeSession + navigate」的优化，全被这段等待抵消。
 * 低配机上平滑滚动更慢、掉帧还可能收不到 scrollend / transitionend，直接吃满 fallback。
 *
 * 连点由 openSession 自己的 token 机制去重，不需要这里再排队。
 */
export function prepareSidebarSelection(element: HTMLElement): void {
	const scrollParent = element.closest<HTMLElement>('[data-sidebar-selection-scroll="true"]');
	if (!scrollParent) return;
	scrollElementIntoSafeZone(scrollParent, element);
}

/** Scrolls a newly expanded project row only when it falls outside the shared safety band. */
export function useExpandedProjectAutoScroll({
	expanded,
	projectRowRef,
	scrollParent,
}: ExpandedProjectAutoScrollOptions): void {
	const wasExpandedRef = useRef(expanded);

	useEffect(() => {
		if (!expanded) {
			wasExpandedRef.current = false;
			return;
		}
		if (wasExpandedRef.current || !scrollParent) return;
		wasExpandedRef.current = true;

		let firstFrame = 0;
		let secondFrame = 0;
		let settleTimer = 0;
		let cancelled = false;
		const ensureProjectVisible = () => {
			if (cancelled || !projectRowRef.current) return;
			scrollElementIntoSafeZone(scrollParent, projectRowRef.current);
		};

		firstFrame = requestAnimationFrame(() => {
			secondFrame = requestAnimationFrame(ensureProjectVisible);
		});
		settleTimer = window.setTimeout(ensureProjectVisible, LAYOUT_SETTLE_DELAY_MS);

		return () => {
			cancelled = true;
			cancelAnimationFrame(firstFrame);
			cancelAnimationFrame(secondFrame);
			window.clearTimeout(settleTimer);
		};
	}, [expanded, projectRowRef, scrollParent]);
}

/**
 * Keeps a newly selected session inside the middle safety band of its scroll viewport.
 * Tiny scroll ranges and corrections are intentionally ignored to avoid distracting micro-movements.
 */
export function useActiveSessionAutoScroll({
	activeIndex,
	activeKey,
	enabled = true,
	scrollParent,
	virtuosoRef,
}: ActiveSessionAutoScrollOptions): void {
	const handledActiveKeyRef = useRef<string | null>(null);

	useEffect(() => {
		if (!activeKey) {
			handledActiveKeyRef.current = null;
			return;
		}
		if (!enabled || !scrollParent || activeIndex < 0 || handledActiveKeyRef.current === activeKey) return;
		handledActiveKeyRef.current = activeKey;

		let firstFrame = 0;
		let secondFrame = 0;
		let settleTimer = 0;
		let cancelled = false;

		const ensureVisible = () => {
			if (cancelled || !hasUsefulScrollRange(scrollParent)) return;
			if (scrollMountedActiveRow(scrollParent)) return;

			const viewportHeight = scrollParent.clientHeight;
			virtuosoRef.current?.scrollToIndex({
				index: activeIndex,
				align: "start",
				offset: -(viewportHeight * SAFE_ZONE_TOP_RATIO - VIRTUAL_SESSION_ROW_HEIGHT / 2),
				behavior: prefersReducedMotion() ? "auto" : "smooth",
			});
		};

		firstFrame = requestAnimationFrame(() => {
			secondFrame = requestAnimationFrame(ensureVisible);
		});
		settleTimer = window.setTimeout(ensureVisible, LAYOUT_SETTLE_DELAY_MS);

		return () => {
			cancelled = true;
			cancelAnimationFrame(firstFrame);
			cancelAnimationFrame(secondFrame);
			window.clearTimeout(settleTimer);
		};
	}, [activeIndex, activeKey, enabled, scrollParent, virtuosoRef]);
}
