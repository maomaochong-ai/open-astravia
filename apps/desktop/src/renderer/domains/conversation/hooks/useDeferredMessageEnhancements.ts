import { startTransition, useEffect, useRef, useState } from "react";

const DEFERRED_STABILIZATION_MS = 400;
const DEFERRED_IDLE_TIMEOUT_MS = 1_500;

/**
 * Delay non-critical conversation derivations until the first visible message
 * frame has settled. Virtual-list buffering is intentionally not controlled
 * here; it follows explicit history-browsing intent in the scroll model.
 */
export function useDeferredMessageEnhancements(sessionId: string | null, hasMessages: boolean): boolean {
	const sessionRef = useRef(sessionId);
	const generationRef = useRef(0);
	if (sessionRef.current !== sessionId) {
		sessionRef.current = sessionId;
		generationRef.current += 1;
	}
	const generation = generationRef.current;
	const [readyState, setReadyState] = useState(() => ({ generation, ready: false }));
	const ready = hasMessages && readyState.generation === generation && readyState.ready;

	useEffect(() => {
		if (!hasMessages || ready) return;
		let cancelled = false;
		let firstFrameId: number | null = null;
		let secondFrameId: number | null = null;
		let stabilizationTimerId: number | null = null;
		let idleCallbackId: number | null = null;
		const markReady = (): void => {
			if (cancelled) return;
			startTransition(() => {
				setReadyState((current) => (generationRef.current === generation ? { generation, ready: true } : current));
			});
		};
		const scheduleIdleWork = (): void => {
			stabilizationTimerId = null;
			if (typeof window.requestIdleCallback === "function") {
				idleCallbackId = window.requestIdleCallback(markReady, { timeout: DEFERRED_IDLE_TIMEOUT_MS });
				return;
			}
			stabilizationTimerId = window.setTimeout(markReady, 0);
		};
		const waitForStability = (): void => {
			stabilizationTimerId = window.setTimeout(scheduleIdleWork, DEFERRED_STABILIZATION_MS);
		};

		if (typeof window.requestAnimationFrame === "function") {
			firstFrameId = window.requestAnimationFrame(() => {
				firstFrameId = null;
				secondFrameId = window.requestAnimationFrame(() => {
					secondFrameId = null;
					waitForStability();
				});
			});
		} else {
			waitForStability();
		}

		return () => {
			cancelled = true;
			if (firstFrameId !== null) window.cancelAnimationFrame(firstFrameId);
			if (secondFrameId !== null) window.cancelAnimationFrame(secondFrameId);
			if (stabilizationTimerId !== null) window.clearTimeout(stabilizationTimerId);
			if (idleCallbackId !== null) window.cancelIdleCallback(idleCallbackId);
		};
	}, [generation, hasMessages, ready]);

	return ready;
}
