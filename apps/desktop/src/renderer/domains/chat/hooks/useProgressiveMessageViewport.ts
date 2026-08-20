import { startTransition, useEffect, useState } from "react";

const EXPANDED_VIEWPORT_IDLE_TIMEOUT_MS = 300;

/**
 * Render the target session's real visible rows immediately, then pre-render
 * the surrounding off-screen rows when the browser has idle budget. Content
 * and row identity never change between phases, so Virtuoso has no visible
 * height correction to perform.
 */
export function useProgressiveMessageViewport(sessionId: string | null, hasMessages: boolean): "initial" | "expanded" {
	const [expandedSessionId, setExpandedSessionId] = useState<string | null>(sessionId);

	useEffect(() => {
		if (expandedSessionId === sessionId || !hasMessages) return;
		let cancelled = false;
		const expand = (): void => {
			if (cancelled) return;
			startTransition(() => setExpandedSessionId(sessionId));
		};

		if (typeof window.requestIdleCallback === "function") {
			const idleId = window.requestIdleCallback(expand, { timeout: EXPANDED_VIEWPORT_IDLE_TIMEOUT_MS });
			return () => {
				cancelled = true;
				window.cancelIdleCallback(idleId);
			};
		}

		const timerId = window.setTimeout(expand, 0);
		return () => {
			cancelled = true;
			window.clearTimeout(timerId);
		};
	}, [expandedSessionId, hasMessages, sessionId]);

	return expandedSessionId === sessionId ? "expanded" : "initial";
}
