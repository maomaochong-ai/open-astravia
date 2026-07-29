import {
	type PointerEvent as ReactPointerEvent,
	type RefObject,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";

const DRAG_THRESHOLD_PX = 4;

interface DragState {
	pointerId: number;
	startScrollLeft: number;
	startX: number;
	moved: boolean;
}

export interface UseHorizontalDragScrollOptions {
	/** Rebuild edge state when list length changes. */
	readonly itemCount: number;
	/** Fraction of clientWidth to scroll on arrow click. Default 0.8. */
	readonly pageFactor?: number;
}

export interface UseHorizontalDragScrollResult {
	readonly canNext: boolean;
	readonly canPrev: boolean;
	readonly dragging: boolean;
	readonly scrollRef: RefObject<HTMLDivElement | null>;
	readonly onLostPointerCapture: () => void;
	readonly onPointerCancel: (event: ReactPointerEvent<HTMLDivElement>) => void;
	readonly onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
	readonly onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
	readonly onPointerUp: (event: ReactPointerEvent<HTMLDivElement>) => void;
	readonly onScroll: () => void;
	readonly scrollByPage: (dir: -1 | 1) => void;
	/** True when the last pointer gesture moved enough to count as a drag (suppress child click). */
	readonly shouldSuppressClick: () => boolean;
	readonly updateEdges: () => void;
}

/**
 * Horizontal overflow track with edge state, page arrows, and pointer drag scroll.
 * Drag past a small threshold suppresses the subsequent click so badges stay selectable by tap.
 */
export function useHorizontalDragScroll({
	itemCount,
	pageFactor = 0.8,
}: UseHorizontalDragScrollOptions): UseHorizontalDragScrollResult {
	const scrollRef = useRef<HTMLDivElement>(null);
	const dragRef = useRef<DragState | null>(null);
	const suppressClickRef = useRef(false);
	const [canPrev, setCanPrev] = useState(false);
	const [canNext, setCanNext] = useState(false);
	const [dragging, setDragging] = useState(false);

	const updateEdges = useCallback(() => {
		const el = scrollRef.current;
		if (!el) return;
		setCanPrev(el.scrollLeft > 1);
		setCanNext(el.scrollLeft < el.scrollWidth - el.clientWidth - 1);
	}, []);

	useEffect(() => {
		// List length is part of the effect graph so we remeasure after items mount/unmount
		// (content width can change without a ResizeObserver hit on the track).
		if (itemCount < 0) return;
		updateEdges();
		const el = scrollRef.current;
		if (!el) return;
		const ro = new ResizeObserver(updateEdges);
		ro.observe(el);
		return () => ro.disconnect();
	}, [itemCount, updateEdges]);

	const scrollByPage = useCallback(
		(dir: -1 | 1) => {
			const el = scrollRef.current;
			if (!el) return;
			el.scrollBy({ left: dir * el.clientWidth * pageFactor, behavior: "smooth" });
		},
		[pageFactor],
	);

	const finishDrag = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
		const track = scrollRef.current;
		const drag = dragRef.current;
		if (!track || !drag || drag.pointerId !== event.pointerId) return;
		dragRef.current = null;
		if (track.hasPointerCapture(event.pointerId)) {
			track.releasePointerCapture(event.pointerId);
		}
		setDragging(false);
		if (drag.moved) {
			// Clear after the click that follows pointerup (same event loop turn).
			window.setTimeout(() => {
				suppressClickRef.current = false;
			}, 0);
		}
	}, []);

	const onPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
		const track = scrollRef.current;
		if (!track || event.button !== 0) return;
		dragRef.current = {
			pointerId: event.pointerId,
			startX: event.clientX,
			startScrollLeft: track.scrollLeft,
			moved: false,
		};
		track.setPointerCapture(event.pointerId);
		setDragging(true);
	}, []);

	const onPointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
		const track = scrollRef.current;
		const drag = dragRef.current;
		if (!track || !drag || drag.pointerId !== event.pointerId) return;
		const deltaX = event.clientX - drag.startX;
		if (!drag.moved && Math.abs(deltaX) > DRAG_THRESHOLD_PX) {
			drag.moved = true;
			suppressClickRef.current = true;
		}
		if (!drag.moved) return;
		event.preventDefault();
		track.scrollLeft = drag.startScrollLeft - deltaX;
	}, []);

	const onLostPointerCapture = useCallback(() => {
		dragRef.current = null;
		setDragging(false);
	}, []);

	const shouldSuppressClick = useCallback(() => suppressClickRef.current, []);

	return {
		canNext,
		canPrev,
		dragging,
		scrollRef,
		onLostPointerCapture,
		onPointerCancel: finishDrag,
		onPointerDown,
		onPointerMove,
		onPointerUp: finishDrag,
		onScroll: updateEdges,
		scrollByPage,
		shouldSuppressClick,
		updateEdges,
	};
}
