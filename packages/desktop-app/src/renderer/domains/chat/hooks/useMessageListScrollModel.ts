import { activityPanelResizingAtom, type ChatMessage, pendingScrollToEntryAtom } from "@shared/store/atoms";
import { getDefaultStore, useAtomValue } from "jotai";
import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import type { VirtuosoHandle } from "react-virtuoso";

const MIN_SCROLL_LERP_RATIO = 0.045;
const IDLE_MAX_SCROLL_LERP_RATIO = 0.18;
const STREAMING_MAX_SCROLL_LERP_RATIO = 0.28;
const SCROLL_DISTANCE_FOR_MAX_RATIO = 900;
/** 贴底静止时的降频测量间隔：每 N 帧才读一次布局，而不是每帧强制 reflow。 */
const IDLE_MEASURE_EVERY_N_FRAMES = 4;

function getScrollLerpRatio(diff: number, isStreaming: boolean): number {
	const maxRatio = isStreaming ? STREAMING_MAX_SCROLL_LERP_RATIO : IDLE_MAX_SCROLL_LERP_RATIO;
	const distanceRatio = Math.min(1, diff / SCROLL_DISTANCE_FOR_MAX_RATIO);
	return MIN_SCROLL_LERP_RATIO + (maxRatio - MIN_SCROLL_LERP_RATIO) * distanceRatio;
}

interface MessageListScrollModelInput {
	isStreaming: boolean;
	messages: ChatMessage[];
	sessionId?: string | null;
}

export interface MessageListScrollModel {
	onAtBottomChange: (atBottom: boolean) => void;
	scrollerRef: (element: HTMLElement | Window | null) => void;
	virtuosoRef: React.RefObject<VirtuosoHandle | null>;
}

export function useMessageListScrollModel({
	isStreaming,
	messages,
	sessionId,
}: MessageListScrollModelInput): MessageListScrollModel {
	const virtuosoRef = useRef<VirtuosoHandle>(null);
	const scrollerElementRef = useRef<HTMLElement | null>(null);
	const activityPanelResizing = useAtomValue(activityPanelResizingAtom);
	const activityPanelResizingRef = useRef(activityPanelResizing);
	const previousActivityPanelResizingRef = useRef(activityPanelResizing);
	activityPanelResizingRef.current = activityPanelResizing;
	const atBottomRef = useRef(true);
	const shouldFollowBottomRef = useRef(true);
	const lerpAnimationFrameRef = useRef<number | null>(null);
	const idleFrameCountRef = useRef(0);
	const lastTouchYRef = useRef<number | null>(null);
	const isStreamingRef = useRef(isStreaming);
	isStreamingRef.current = isStreaming;

	const tickLerp = useCallback(() => {
		const element = scrollerElementRef.current;
		if (!element || !shouldFollowBottomRef.current) {
			lerpAnimationFrameRef.current = null;
			idleFrameCountRef.current = 0;
			return;
		}
		// 流式期间这个循环会一直空转（内容可能因为图片/高亮异步撑高，而 scroller 的
		// ResizeObserver 只报 border-box、报不出 scrollHeight 变化，所以不能直接停）。
		// 但每帧读 scrollHeight/clientHeight 都是一次强制同步布局；贴底静止时按
		// IDLE_MEASURE_EVERY_N_FRAMES 降频测量，把这份 reflow 摊薄。
		if (idleFrameCountRef.current > 0 && idleFrameCountRef.current % IDLE_MEASURE_EVERY_N_FRAMES !== 0) {
			idleFrameCountRef.current++;
			lerpAnimationFrameRef.current = requestAnimationFrame(tickLerp);
			return;
		}
		const target = Math.max(0, element.scrollHeight - element.clientHeight);
		const diff = target - element.scrollTop;
		if (diff > 0.5) {
			idleFrameCountRef.current = 0;
			element.scrollTop = element.scrollTop + diff * getScrollLerpRatio(diff, isStreamingRef.current);
			lerpAnimationFrameRef.current = requestAnimationFrame(tickLerp);
		} else if (isStreamingRef.current) {
			idleFrameCountRef.current++;
			lerpAnimationFrameRef.current = requestAnimationFrame(tickLerp);
		} else {
			idleFrameCountRef.current = 0;
			lerpAnimationFrameRef.current = null;
		}
	}, []);

	const startFollowingBottom = useCallback(() => {
		// 有新内容进来就恢复逐帧测量，别让降频把这次追底拖后。
		idleFrameCountRef.current = 0;
		if (lerpAnimationFrameRef.current === null) {
			lerpAnimationFrameRef.current = requestAnimationFrame(tickLerp);
		}
	}, [tickLerp]);

	const onAtBottomChange = useCallback(
		(atBottom: boolean) => {
			atBottomRef.current = atBottom;
			if (atBottom) {
				shouldFollowBottomRef.current = true;
				startFollowingBottom();
			}
		},
		[startFollowingBottom],
	);

	const stopFollowingBottom = useCallback(() => {
		shouldFollowBottomRef.current = false;
		idleFrameCountRef.current = 0;
		if (lerpAnimationFrameRef.current !== null) {
			cancelAnimationFrame(lerpAnimationFrameRef.current);
			lerpAnimationFrameRef.current = null;
		}
	}, []);

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

	const previousSessionIdRef = useRef<string | null | undefined>(sessionId);
	const skipNextLerpRef = useRef(false);

	useEffect(() => {
		if (previousSessionIdRef.current === sessionId) return;
		previousSessionIdRef.current = sessionId;
		if (lerpAnimationFrameRef.current !== null) {
			cancelAnimationFrame(lerpAnimationFrameRef.current);
			lerpAnimationFrameRef.current = null;
		}
		atBottomRef.current = true;
		shouldFollowBottomRef.current = true;
		skipNextLerpRef.current = true;

		const store = getDefaultStore();
		const pending = store.get(pendingScrollToEntryAtom);
		if (pending?.entryId) {
			// Defer scroll-to-entry until messages for the new session are present.
			shouldFollowBottomRef.current = false;
			return;
		}
		requestAnimationFrame(() => {
			virtuosoRef.current?.scrollToIndex({ index: "LAST", align: "end", behavior: "auto" });
		});
	}, [sessionId]);

	// Jump to a specific entry after opening a parent session from a fork banner.
	useEffect(() => {
		const store = getDefaultStore();
		const pending = store.get(pendingScrollToEntryAtom);
		if (!pending?.entryId || messages.length === 0) return;
		const index = messages.findIndex((m) => m.entryId === pending.entryId || m.id === pending.entryId);
		if (index < 0) {
			// Parent may lack that entry (deleted branch); still clear pending and go bottom.
			store.set(pendingScrollToEntryAtom, null);
			shouldFollowBottomRef.current = true;
			requestAnimationFrame(() => {
				virtuosoRef.current?.scrollToIndex({ index: "LAST", align: "end", behavior: "auto" });
			});
			return;
		}
		store.set(pendingScrollToEntryAtom, null);
		shouldFollowBottomRef.current = false;
		atBottomRef.current = false;
		skipNextLerpRef.current = true;
		requestAnimationFrame(() => {
			virtuosoRef.current?.scrollToIndex({ index, align: "center", behavior: "smooth" });
		});
	}, [messages]);

	useEffect(() => {
		void messages;
		void isStreaming;
		if (skipNextLerpRef.current) {
			skipNextLerpRef.current = false;
			return;
		}
		if (shouldFollowBottomRef.current) startFollowingBottom();
	}, [messages, isStreaming, startFollowingBottom]);

	// 新用户消息：直接贴底跟随。这里曾经要先把跟随关掉、等气泡入场动画播完再打开，
	// 那条路径每次发送都会在 layout effect 里再 setState 一次，把整张列表同步重渲
	// （Profiler 里表现为 nested-update）。入场动画去掉后不再需要这层等待。
	const previousMessageCountRef = useRef(messages.length);
	useLayoutEffect(() => {
		const previousCount = previousMessageCountRef.current;
		previousMessageCountRef.current = messages.length;
		const newMessage = messages.at(-1);
		if (messages.length > previousCount && newMessage?.role === "user") {
			atBottomRef.current = true;
			shouldFollowBottomRef.current = true;
		}
	}, [messages]);

	const scrollerRef = useCallback((element: HTMLElement | Window | null) => {
		scrollerElementRef.current = element instanceof HTMLElement ? element : null;
		if (scrollerElementRef.current) {
			scrollerElementRef.current.style.overflowAnchor = "none";
		}
	}, []);
	const snapToBottom = useCallback(() => {
		const element = scrollerElementRef.current;
		if (!element || !shouldFollowBottomRef.current) return;
		const target = Math.max(0, element.scrollHeight - element.clientHeight);
		if (Math.abs(target - element.scrollTop) > 0.5) element.scrollTop = target;
	}, []);

	useEffect(() => {
		const wasResizing = previousActivityPanelResizingRef.current;
		previousActivityPanelResizingRef.current = activityPanelResizing;
		if (!wasResizing || activityPanelResizing) return;
		const animationFrame = requestAnimationFrame(snapToBottom);
		return () => cancelAnimationFrame(animationFrame);
	}, [activityPanelResizing, snapToBottom]);

	useEffect(() => {
		const element = scrollerElementRef.current;
		if (!element) return;
		element.addEventListener("wheel", onWheel, { passive: true });
		element.addEventListener("touchstart", onTouchStart, { passive: true });
		element.addEventListener("touchmove", onTouchMove, { passive: true });
		// Viewport size changes (e.g. input bar grow/shrink) clamp scrollTop.
		// While sticky, snap immediately so we do not need multi-frame lerp thrash.
		// ResizeObserver only fires on border-box size, not content scrollHeight —
		// streaming growth still uses the messages/isStreaming lerp path.
		const onViewportResize = (): void => {
			if (activityPanelResizingRef.current) return;
			snapToBottom();
		};
		const resizeObserver = new ResizeObserver(onViewportResize);
		resizeObserver.observe(element);
		return () => {
			element.removeEventListener("wheel", onWheel);
			element.removeEventListener("touchstart", onTouchStart);
			element.removeEventListener("touchmove", onTouchMove);
			resizeObserver.disconnect();
		};
	}, [onWheel, onTouchMove, onTouchStart, snapToBottom]);

	useEffect(
		() => () => {
			if (lerpAnimationFrameRef.current !== null) {
				cancelAnimationFrame(lerpAnimationFrameRef.current);
			}
		},
		[],
	);

	return {
		onAtBottomChange,
		scrollerRef,
		virtuosoRef,
	};
}
