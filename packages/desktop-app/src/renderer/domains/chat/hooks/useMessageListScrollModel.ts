import { activityPanelResizingAtom, type ChatMessage, pendingScrollToEntryAtom } from "@shared/store/atoms";
import { getDefaultStore, useAtomValue } from "jotai";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { VirtuosoHandle } from "react-virtuoso";

const MIN_SCROLL_LERP_RATIO = 0.045;
const IDLE_MAX_SCROLL_LERP_RATIO = 0.18;
const STREAMING_MAX_SCROLL_LERP_RATIO = 0.28;
const SCROLL_DISTANCE_FOR_MAX_RATIO = 900;

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
	activeUserAnimationId: string | null;
	enteringUserMessageId: string | null;
	onAtBottomChange: (atBottom: boolean) => void;
	onUserMessageEntryComplete: () => void;
	pendingUserAnimationId: string | null;
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
	const previousRenderMessageCountRef = useRef(messages.length);
	const lastMessage = messages.at(-1);
	const enteringUserMessageId =
		messages.length > previousRenderMessageCountRef.current && lastMessage?.role === "user" ? lastMessage.id : null;
	const [pendingUserAnimationId, setPendingUserAnimationId] = useState<string | null>(null);
	const pendingUserAnimationIdRef = useRef<string | null>(null);
	const [activeUserAnimationId, setActiveUserAnimationId] = useState<string | null>(null);
	const lerpAnimationFrameRef = useRef<number | null>(null);
	const lastTouchYRef = useRef<number | null>(null);
	const isStreamingRef = useRef(isStreaming);
	isStreamingRef.current = isStreaming;

	const releasePendingUserAnimation = useCallback(() => {
		const id = pendingUserAnimationIdRef.current;
		if (!id) return;
		pendingUserAnimationIdRef.current = null;
		setPendingUserAnimationId(null);
		setActiveUserAnimationId(id);
	}, []);

	const tickLerp = useCallback(() => {
		const element = scrollerElementRef.current;
		if (!element || !shouldFollowBottomRef.current) {
			lerpAnimationFrameRef.current = null;
			return;
		}
		const target = Math.max(0, element.scrollHeight - element.clientHeight);
		const diff = target - element.scrollTop;
		if (diff > 0.5) {
			element.scrollTop = element.scrollTop + diff * getScrollLerpRatio(diff, isStreamingRef.current);
			lerpAnimationFrameRef.current = requestAnimationFrame(tickLerp);
		} else if (isStreamingRef.current) {
			releasePendingUserAnimation();
			lerpAnimationFrameRef.current = requestAnimationFrame(tickLerp);
		} else {
			releasePendingUserAnimation();
			lerpAnimationFrameRef.current = null;
		}
	}, [releasePendingUserAnimation]);

	const startFollowingBottom = useCallback(() => {
		if (lerpAnimationFrameRef.current === null) {
			lerpAnimationFrameRef.current = requestAnimationFrame(tickLerp);
		}
	}, [tickLerp]);

	const onAtBottomChange = useCallback(
		(atBottom: boolean) => {
			atBottomRef.current = atBottom;
			if (atBottom) {
				shouldFollowBottomRef.current = true;
				releasePendingUserAnimation();
				startFollowingBottom();
			}
		},
		[releasePendingUserAnimation, startFollowingBottom],
	);

	const stopFollowingBottom = useCallback(() => {
		shouldFollowBottomRef.current = false;
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
		pendingUserAnimationIdRef.current = null;
		setPendingUserAnimationId(null);
		setActiveUserAnimationId(null);
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

	const previousMessageCountRef = useRef(messages.length);
	useLayoutEffect(() => {
		const previousCount = previousMessageCountRef.current;
		previousMessageCountRef.current = messages.length;
		const newMessage = messages.at(-1);
		if (messages.length > previousCount && newMessage?.role === "user") {
			setActiveUserAnimationId(newMessage.id);
			pendingUserAnimationIdRef.current = null;
			setPendingUserAnimationId(null);
			atBottomRef.current = true;
			shouldFollowBottomRef.current = false;
			skipNextLerpRef.current = true;
		}
	}, [messages]);

	useEffect(() => {
		previousRenderMessageCountRef.current = messages.length;
	}, [messages.length]);

	const onUserMessageEntryComplete = useCallback(() => {
		setActiveUserAnimationId(null);
		shouldFollowBottomRef.current = true;
		startFollowingBottom();
	}, [startFollowingBottom]);

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
		activeUserAnimationId,
		enteringUserMessageId,
		onAtBottomChange,
		onUserMessageEntryComplete,
		pendingUserAnimationId,
		scrollerRef,
		virtuosoRef,
	};
}
