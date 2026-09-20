import { startTransition, useEffect, useRef, useState } from "react";

const VIEWPORT_STABILIZATION_MS = 400;
const EXPANDED_VIEWPORT_IDLE_TIMEOUT_MS = 1_500;

/**
 * Render the target session's real visible rows immediately, then pre-render
 * the surrounding off-screen rows when the browser has idle budget. Content
 * and row identity never change between phases, so Virtuoso has no visible
 * height correction to perform.
 */
export function useProgressiveMessageViewport(sessionId: string | null, hasMessages: boolean): "initial" | "expanded" {
	const sessionRef = useRef(sessionId);
	const generationRef = useRef(0);
	if (sessionRef.current !== sessionId) {
		sessionRef.current = sessionId;
		generationRef.current += 1;
	}
	const generation = generationRef.current;
	const [expandedViewport, setExpandedViewport] = useState(() => ({
		generation,
		expanded: false,
	}));
	const phase = !hasMessages
		? "initial"
		: expandedViewport.generation === generation && expandedViewport.expanded
			? "expanded"
			: "initial";

	useEffect(() => {
		if (!hasMessages) return;
		if (phase === "expanded") return;
		let cancelled = false;
		let firstFrameId: number | null = null;
		let secondFrameId: number | null = null;
		let stabilizationTimerId: number | null = null;
		let idleCallbackId: number | null = null;
		const expand = (): void => {
			if (cancelled) return;
			startTransition(() => {
				setExpandedViewport((current) =>
					generationRef.current === generation ? { generation, expanded: true } : current,
				);
			});
		};
		const scheduleIdleExpansion = (): void => {
			stabilizationTimerId = null;
			if (typeof window.requestIdleCallback === "function") {
				idleCallbackId = window.requestIdleCallback(expand, { timeout: EXPANDED_VIEWPORT_IDLE_TIMEOUT_MS });
				return;
			}
			stabilizationTimerId = window.setTimeout(expand, 0);
		};
		const waitForStability = (): void => {
			stabilizationTimerId = window.setTimeout(scheduleIdleExpansion, VIEWPORT_STABILIZATION_MS);
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
	}, [generation, hasMessages, phase]);

	return phase;
}
