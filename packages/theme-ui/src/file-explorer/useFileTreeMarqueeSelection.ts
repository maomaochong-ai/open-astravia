import { type MouseEvent, type RefObject, useCallback, useRef, useState } from "react";

export interface FileTreeMarqueeRect {
	left: number;
	top: number;
	width: number;
	height: number;
}

interface UseFileTreeMarqueeSelectionParams {
	/** Current selection (snapshotted at mousedown for additive marquee). */
	selectedPaths: ReadonlySet<string>;
	/**
	 * Apply the full selection for this marquee frame (already ordered by host if needed).
	 * Non-additive starts with `[]` before the drag threshold; then passes hit paths (or base∪hits).
	 */
	onMarqueeSelect: (paths: readonly string[]) => void;
}

interface UseFileTreeMarqueeSelectionResult {
	scrollRef: RefObject<HTMLDivElement | null>;
	marquee: FileTreeMarqueeRect | null;
	onMouseDown: (event: MouseEvent) => void;
}

const DRAG_THRESHOLD = 4;
const ROW_SELECTOR = "[data-file-path]";

/**
 * Drag-select on empty space in the file tree scroll container.
 * Intersects rows with `data-file-path`. cmd/ctrl/shift = additive (base ∪ hits).
 * Swallows the trailing click after a real marquee so row/background click handlers do not wipe the selection.
 */
export function useFileTreeMarqueeSelection({
	selectedPaths,
	onMarqueeSelect,
}: UseFileTreeMarqueeSelectionParams): UseFileTreeMarqueeSelectionResult {
	const scrollRef = useRef<HTMLDivElement>(null);
	const [marquee, setMarquee] = useState<FileTreeMarqueeRect | null>(null);
	const selectedPathsRef = useRef(selectedPaths);
	selectedPathsRef.current = selectedPaths;

	const onMouseDown = useCallback(
		(event: MouseEvent) => {
			if (event.button !== 0) return;
			const target = event.target;
			if (!(target instanceof Element)) return;
			// Rows own their own click / native file drag; only start from empty chrome.
			if (target.closest(ROW_SELECTOR)) return;
			if (target.closest("input,textarea,button,a,[contenteditable=true]")) return;

			const container = scrollRef.current;
			if (!container) return;

			const toContent = (clientX: number, clientY: number, rect: DOMRect) => ({
				x: clientX - rect.left + container.scrollLeft,
				y: clientY - rect.top + container.scrollTop,
			});
			const startRect = container.getBoundingClientRect();
			const start = toContent(event.clientX, event.clientY, startRect);
			const additive = event.metaKey || event.ctrlKey || event.shiftKey;
			const basePaths = additive ? [...selectedPathsRef.current] : [];
			let moved = false;

			if (!additive) onMarqueeSelect([]);

			const onMove = (e: globalThis.MouseEvent) => {
				const rect = container.getBoundingClientRect();
				const cur = toContent(e.clientX, e.clientY, rect);
				const left = Math.min(start.x, cur.x);
				const top = Math.min(start.y, cur.y);
				const width = Math.abs(cur.x - start.x);
				const height = Math.abs(cur.y - start.y);
				if (!moved && width < DRAG_THRESHOLD && height < DRAG_THRESHOLD) return;
				moved = true;
				e.preventDefault();
				setMarquee({ left, top, width, height });

				const right = left + width;
				const bottom = top + height;
				const hits: string[] = [];
				for (const el of container.querySelectorAll<HTMLElement>(ROW_SELECTOR)) {
					const ir = el.getBoundingClientRect();
					const ix = ir.left - rect.left + container.scrollLeft;
					const iy = ir.top - rect.top + container.scrollTop;
					const intersects = ix < right && ix + ir.width > left && iy < bottom && iy + ir.height > top;
					if (!intersects) continue;
					const path = el.dataset.filePath;
					if (path) hits.push(path);
				}
				onMarqueeSelect(additive ? [...new Set([...basePaths, ...hits])] : hits);
			};

			const onUp = () => {
				window.removeEventListener("mousemove", onMove);
				window.removeEventListener("mouseup", onUp);
				setMarquee(null);
				if (moved) {
					const swallowClick = (clickEvent: globalThis.MouseEvent) => {
						clickEvent.preventDefault();
						clickEvent.stopPropagation();
						window.removeEventListener("click", swallowClick, true);
					};
					window.addEventListener("click", swallowClick, true);
				}
			};

			window.addEventListener("mousemove", onMove);
			window.addEventListener("mouseup", onUp);
		},
		[onMarqueeSelect],
	);

	return { scrollRef, marquee, onMouseDown };
}
