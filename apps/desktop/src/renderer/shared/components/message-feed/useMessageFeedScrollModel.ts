import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { VirtuosoHandle } from "react-virtuoso";

const MIN_SCROLL_LERP_RATIO = 0.045;
const IDLE_MAX_SCROLL_LERP_RATIO = 0.18;
const ACTIVE_MAX_SCROLL_LERP_RATIO = 0.28;
const SCROLL_DISTANCE_FOR_MAX_RATIO = 900;
const IDLE_MEASURE_EVERY_N_FRAMES = 4;

function getScrollLerpRatio(diff: number, active: boolean): number {
	const maxRatio = active ? ACTIVE_MAX_SCROLL_LERP_RATIO : IDLE_MAX_SCROLL_LERP_RATIO;
	const distanceRatio = Math.min(1, diff / SCROLL_DISTANCE_FOR_MAX_RATIO);
	return MIN_SCROLL_LERP_RATIO + (maxRatio - MIN_SCROLL_LERP_RATIO) * distanceRatio;
}

export interface MessageFeedScrollModel {
	readonly onAtBottomChange: (atBottom: boolean) => void;
	readonly scrollerElement: HTMLElement | null;
	readonly scrollerRef: (element: HTMLElement | Window | null) => void;
	readonly scrollToItem: (index: number) => void;
	readonly virtuosoRef: React.RefObject<VirtuosoHandle | null>;
}

export interface MessageFeedScrollModelInput<T> {
	readonly active: boolean;
	readonly items: readonly T[];
	readonly resetKey?: string | null;
	readonly layoutResizing?: boolean;
	readonly initialTargetKey?: string | null;
	readonly getItemKey?: (item: T) => string | null;
	readonly onInitialTargetHandled?: () => void;
	readonly shouldFollowOnAppend?: (item: T) => boolean;
}

/** Feed viewport mechanics with no message schema, global store or product policy. */
export function useMessageFeedScrollModel<T>({
	active,
	items,
	resetKey,
	layoutResizing = false,
	initialTargetKey,
	getItemKey,
	onInitialTargetHandled,
	shouldFollowOnAppend,
}: MessageFeedScrollModelInput<T>): MessageFeedScrollModel {
	const virtuosoRef = useRef<VirtuosoHandle>(null);
	const scrollerElementRef = useRef<HTMLElement | null>(null);
	const [scrollerElement, setScrollerElement] = useState<HTMLElement | null>(null);
	const layoutResizingRef = useRef(layoutResizing);
	const previousLayoutResizingRef = useRef(layoutResizing);
	layoutResizingRef.current = layoutResizing;
	const shouldFollowBottomRef = useRef(true);
	const lerpAnimationFrameRef = useRef<number | null>(null);
	const idleFrameCountRef = useRef(0);
	const lastTouchYRef = useRef<number | null>(null);
	const activeRef = useRef(active);
	activeRef.current = active;
	const skipNextLerpRef = useRef(false);

	const tickLerp = useCallback(() => {
		const element = scrollerElementRef.current;
		if (!element || !shouldFollowBottomRef.current) {
			lerpAnimationFrameRef.current = null;
			idleFrameCountRef.current = 0;
			return;
		}
		if (idleFrameCountRef.current > 0 && idleFrameCountRef.current % IDLE_MEASURE_EVERY_N_FRAMES !== 0) {
			idleFrameCountRef.current++;
			lerpAnimationFrameRef.current = requestAnimationFrame(tickLerp);
			return;
		}
		const target = Math.max(0, element.scrollHeight - element.clientHeight);
		const diff = target - element.scrollTop;
		if (diff > 0.5) {
			idleFrameCountRef.current = 0;
			element.scrollTop += diff * getScrollLerpRatio(diff, activeRef.current);
			lerpAnimationFrameRef.current = requestAnimationFrame(tickLerp);
		} else if (activeRef.current) {
			idleFrameCountRef.current++;
			lerpAnimationFrameRef.current = requestAnimationFrame(tickLerp);
		} else {
			idleFrameCountRef.current = 0;
			lerpAnimationFrameRef.current = null;
		}
	}, []);

	const startFollowingBottom = useCallback(() => {
		idleFrameCountRef.current = 0;
		if (lerpAnimationFrameRef.current === null) {
			lerpAnimationFrameRef.current = requestAnimationFrame(tickLerp);
		}
	}, [tickLerp]);

	const stopFollowingBottom = useCallback(() => {
		shouldFollowBottomRef.current = false;
		idleFrameCountRef.current = 0;
		if (lerpAnimationFrameRef.current !== null) {
			cancelAnimationFrame(lerpAnimationFrameRef.current);
			lerpAnimationFrameRef.current = null;
		}
	}, []);

	const onAtBottomChange = useCallback(
		(atBottom: boolean) => {
			if (!atBottom) return;
			shouldFollowBottomRef.current = true;
			startFollowingBottom();
		},
		[startFollowingBottom],
	);

	const scrollToItem = useCallback(
		(index: number) => {
			stopFollowingBottom();
			skipNextLerpRef.current = true;
			virtuosoRef.current?.scrollToIndex({ index, align: "start", behavior: "smooth" });
		},
		[stopFollowingBottom],
	);

	const onWheel = useCallback(
		(event: WheelEvent) => {
			if (event.deltaY < 0) stopFollowingBottom();
		},
		[stopFollowingBottom],
	);
	const onTouchStart = useCallback((event: TouchEvent) => {
		lastTouchYRef.current = event.touches[0]?.clientY ?? null;
	}, []);
	const onTouchMove = useCallback(
		(event: TouchEvent) => {
			const y = event.touches[0]?.clientY;
			if (y == null) return;
			const last = lastTouchYRef.current;
			lastTouchYRef.current = y;
			if (last != null && y > last) stopFollowingBottom();
		},
		[stopFollowingBottom],
	);

	const previousResetKeyRef = useRef<string | null | undefined>(resetKey);
	useEffect(() => {
		if (previousResetKeyRef.current === resetKey) return;
		previousResetKeyRef.current = resetKey;
		if (lerpAnimationFrameRef.current !== null) {
			cancelAnimationFrame(lerpAnimationFrameRef.current);
			lerpAnimationFrameRef.current = null;
		}
		shouldFollowBottomRef.current = !initialTargetKey;
		skipNextLerpRef.current = true;
		if (initialTargetKey) return;
		requestAnimationFrame(() => {
			virtuosoRef.current?.scrollToIndex({ index: "LAST", align: "end", behavior: "auto" });
		});
	}, [initialTargetKey, resetKey]);

	useEffect(() => {
		if (!initialTargetKey || !getItemKey || items.length === 0) return;
		const index = items.findIndex((item) => getItemKey(item) === initialTargetKey);
		onInitialTargetHandled?.();
		if (index < 0) {
			shouldFollowBottomRef.current = true;
			requestAnimationFrame(() => {
				virtuosoRef.current?.scrollToIndex({ index: "LAST", align: "end", behavior: "auto" });
			});
			return;
		}
		shouldFollowBottomRef.current = false;
		skipNextLerpRef.current = true;
		requestAnimationFrame(() => {
			virtuosoRef.current?.scrollToIndex({ index, align: "center", behavior: "smooth" });
		});
	}, [getItemKey, initialTargetKey, items, onInitialTargetHandled]);

	useEffect(() => {
		void items;
		void active;
		if (skipNextLerpRef.current) {
			skipNextLerpRef.current = false;
			return;
		}
		if (shouldFollowBottomRef.current) startFollowingBottom();
	}, [active, items, startFollowingBottom]);

	const previousItemCountRef = useRef(items.length);
	useLayoutEffect(() => {
		const previousCount = previousItemCountRef.current;
		previousItemCountRef.current = items.length;
		const appendedItem = items.at(-1);
		if (
			items.length > previousCount &&
			appendedItem !== undefined &&
			(shouldFollowOnAppend?.(appendedItem) ?? false)
		) {
			shouldFollowBottomRef.current = true;
		}
	}, [items, shouldFollowOnAppend]);

	const scrollerRef = useCallback((element: HTMLElement | Window | null) => {
		const next = element instanceof HTMLElement ? element : null;
		scrollerElementRef.current = next;
		setScrollerElement(next);
		if (next) next.style.overflowAnchor = "none";
	}, []);

	const snapToBottom = useCallback(() => {
		const element = scrollerElementRef.current;
		if (!element || !shouldFollowBottomRef.current) return;
		const target = Math.max(0, element.scrollHeight - element.clientHeight);
		if (Math.abs(target - element.scrollTop) > 0.5) element.scrollTop = target;
	}, []);

	useEffect(() => {
		const wasResizing = previousLayoutResizingRef.current;
		previousLayoutResizingRef.current = layoutResizing;
		if (!wasResizing || layoutResizing) return;
		const animationFrame = requestAnimationFrame(snapToBottom);
		return () => cancelAnimationFrame(animationFrame);
	}, [layoutResizing, snapToBottom]);

	useEffect(() => {
		const element = scrollerElement;
		if (!element) return;
		element.addEventListener("wheel", onWheel, { passive: true });
		element.addEventListener("touchstart", onTouchStart, { passive: true });
		element.addEventListener("touchmove", onTouchMove, { passive: true });
		const resizeObserver = new ResizeObserver(() => {
			if (!layoutResizingRef.current) snapToBottom();
		});
		resizeObserver.observe(element);
		return () => {
			element.removeEventListener("wheel", onWheel);
			element.removeEventListener("touchstart", onTouchStart);
			element.removeEventListener("touchmove", onTouchMove);
			resizeObserver.disconnect();
		};
	}, [onTouchMove, onTouchStart, onWheel, scrollerElement, snapToBottom]);

	useEffect(
		() => () => {
			if (lerpAnimationFrameRef.current !== null) cancelAnimationFrame(lerpAnimationFrameRef.current);
		},
		[],
	);

	return { onAtBottomChange, scrollerElement, scrollerRef, scrollToItem, virtuosoRef };
}
