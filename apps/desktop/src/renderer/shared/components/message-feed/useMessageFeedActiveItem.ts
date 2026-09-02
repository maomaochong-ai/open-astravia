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

	const onItemsRendered = useCallback(
		(items: ListItem<T>[]) => {
			renderedItemsRef.current = items.map(({ index, offset, size }) => ({ index, offset, size }));
			syncActiveIndex();
		},
		[syncActiveIndex],
	);

	useEffect(() => {
		if (!scrollerElement) return;
		let frame: number | null = null;
		const onScroll = (): void => {
			if (frame != null) return;
			frame = requestAnimationFrame(() => {
				frame = null;
				syncActiveIndex();
			});
		};
		scrollerElement.addEventListener("scroll", onScroll, { passive: true });
		syncActiveIndex();
		return () => {
			if (frame != null) cancelAnimationFrame(frame);
			scrollerElement.removeEventListener("scroll", onScroll);
		};
	}, [scrollerElement, syncActiveIndex]);

	return { activeIndex, onItemsRendered };
}
