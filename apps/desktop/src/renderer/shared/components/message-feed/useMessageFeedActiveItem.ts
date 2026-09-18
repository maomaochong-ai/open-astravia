import { useCallback, useEffect, useRef, useState } from "react";
import type { ListItem } from "react-virtuoso";
import { findTopVisibleItemIndex, type RenderedFeedItem } from "./visibleItemModel";

export function useMessageFeedActiveItem<T>({
	scrollerElement,
	resetKey,
	initialIndex,
}: {
	readonly scrollerElement: HTMLElement | null;
	readonly resetKey?: string | null;
	readonly initialIndex: number;
}): {
	readonly activeIndex: number;
	readonly onItemsRendered: (items: ListItem<T>[]) => void;
} {
	const [activeIndex, setActiveIndex] = useState(initialIndex);
	const initialIndexRef = useRef(initialIndex);
	const renderedItemsRef = useRef<RenderedFeedItem[]>([]);
	initialIndexRef.current = initialIndex;

	useEffect(() => {
		void resetKey;
		setActiveIndex(initialIndexRef.current);
	}, [resetKey]);

	const syncActiveIndex = useCallback(() => {
		if (!scrollerElement) return;
		const index = findTopVisibleItemIndex(renderedItemsRef.current, scrollerElement.scrollTop);
		if (index != null) setActiveIndex(index);
	}, [scrollerElement]);

	/**
	 * 读 `scrollTop` 是一次布局读取，必须折叠到每帧一次。
	 *
	 * 滚动那条路径本来就这么做了，条目重渲染这条漏了：虚拟列表在一次尺寸变化里会反复回调
	 * `itemsRendered`，而每次回调都紧跟在 DOM 写入之后——同步读就是一次强制同步布局，整条
	 * 消息列表重排一遍。拖侧边栏宽度时尺寸每帧都在变，实测这一处吃掉 750ms。
	 */
	const frameRef = useRef<number | null>(null);
	const scheduleSync = useCallback(() => {
		if (frameRef.current != null) return;
		frameRef.current = requestAnimationFrame(() => {
			frameRef.current = null;
			syncActiveIndex();
		});
	}, [syncActiveIndex]);

	const onItemsRendered = useCallback(
		(items: ListItem<T>[]) => {
			renderedItemsRef.current = items.map(({ index, offset, size }) => ({ index, offset, size }));
			scheduleSync();
		},
		[scheduleSync],
	);

	useEffect(() => {
		if (!scrollerElement) return;
		scrollerElement.addEventListener("scroll", scheduleSync, { passive: true });
		scheduleSync();
		return () => {
			scrollerElement.removeEventListener("scroll", scheduleSync);
		};
	}, [scrollerElement, scheduleSync]);

	useEffect(
		() => () => {
			if (frameRef.current != null) cancelAnimationFrame(frameRef.current);
		},
		[],
	);

	return { activeIndex, onItemsRendered };
}
