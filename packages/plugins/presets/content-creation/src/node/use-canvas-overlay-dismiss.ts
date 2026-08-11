import { type RefObject, useEffect } from "react";

/**
 * React Flow may stop pointer events before Radix's document-level outside
 * handlers see them. Observe the capture phase so portaled controls embedded in
 * a node still dismiss consistently when the user presses elsewhere.
 */
export function useCanvasOverlayOutsideDismiss<
	TTrigger extends HTMLElement,
	TContent extends HTMLElement,
>(
	open: boolean,
	triggerRef: RefObject<TTrigger | null>,
	contentRef: RefObject<TContent | null>,
	onDismiss: () => void,
): void {
	useEffect(() => {
		if (!open) return;
		const handlePointerDown = (event: PointerEvent) => {
			const target = event.target;
			if (!(target instanceof globalThis.Node)) return;
			if (triggerRef.current?.contains(target) || contentRef.current?.contains(target)) return;
			onDismiss();
		};

		document.addEventListener("pointerdown", handlePointerDown, true);
		return () => document.removeEventListener("pointerdown", handlePointerDown, true);
	}, [contentRef, onDismiss, open, triggerRef]);
}
