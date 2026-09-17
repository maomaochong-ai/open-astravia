import { waitForCommittedPaint } from "@shared/lib/committed-paint";
import { useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";

export type SidebarSelectionTarget = { kind: "conversation"; path: string } | { kind: "agent-team"; sessionId: string };

type SidebarSelectionIntent = SidebarSelectionTarget & { requestId: number };

export function useSidebarSelectionIntent(): {
	selectionIntent: SidebarSelectionTarget | null;
	selectAfterPaint: (selection: SidebarSelectionTarget, action: () => Promise<unknown>) => void;
} {
	const sequenceRef = useRef(0);
	const currentIntentRef = useRef<SidebarSelectionIntent | null>(null);
	const [selectionIntent, setSelectionIntent] = useState<SidebarSelectionIntent | null>(null);

	const finishSelection = useCallback((requestId: number): void => {
		if (currentIntentRef.current?.requestId !== requestId) return;
		currentIntentRef.current = null;
		setSelectionIntent((current) => (current?.requestId === requestId ? null : current));
	}, []);

	const selectAfterPaint = useCallback(
		(selection: SidebarSelectionTarget, action: () => Promise<unknown>): void => {
			const request: SidebarSelectionIntent = {
				...selection,
				requestId: ++sequenceRef.current,
			};
			currentIntentRef.current = request;
			// This is a discrete pointer action. Commit the lightweight sidebar state before
			// scheduling any navigation/runtime work so concurrent rendering cannot defer it.
			flushSync(() => setSelectionIntent(request));

			// Unlike general presentation work, session opening must not use the timeout
			// escape hatch: that would let heavy content work start before the highlight was
			// visibly painted, recreating the lag this barrier is meant to prevent.
			void waitForCommittedPaint({ timeoutMs: null }).then(() => {
				if (currentIntentRef.current?.requestId !== request.requestId) return;
				let operation: Promise<unknown>;
				try {
					operation = action();
				} catch {
					finishSelection(request.requestId);
					return;
				}
				void operation.then(
					() => finishSelection(request.requestId),
					() => finishSelection(request.requestId),
				);
			});
		},
		[finishSelection],
	);

	useEffect(
		() => () => {
			currentIntentRef.current = null;
		},
		[],
	);

	return { selectionIntent, selectAfterPaint };
}
