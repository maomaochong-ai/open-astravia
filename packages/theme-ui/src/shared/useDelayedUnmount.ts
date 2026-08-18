import { useEffect, useRef, useState } from "react";

/**
 * Keep content mounted for `delayMs` after `open` turns false, so a pure-CSS
 * collapse transition can play before the subtree unmounts. Returns whether
 * the content should currently be rendered.
 *
 * Opening is synchronous (render immediately); only unmount is delayed.
 */
export function useDelayedUnmount(open: boolean, delayMs: number): boolean {
	const [mounted, setMounted] = useState(open);
	const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	useEffect(() => {
		if (open) {
			if (timerRef.current !== null) {
				clearTimeout(timerRef.current);
				timerRef.current = null;
			}
			setMounted(true);
			return;
		}
		timerRef.current = setTimeout(() => {
			timerRef.current = null;
			setMounted(false);
		}, delayMs);
		return () => {
			if (timerRef.current !== null) {
				clearTimeout(timerRef.current);
				timerRef.current = null;
			}
		};
	}, [open, delayMs]);

	return open || mounted;
}
