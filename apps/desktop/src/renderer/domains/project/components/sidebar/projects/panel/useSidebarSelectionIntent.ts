import { waitForCommittedPaint } from "@shared/lib/committed-paint";
import { useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import type { SidebarSelectionTarget } from "./sidebar-selection-state";

type SidebarSelectionIntent = SidebarSelectionTarget & {
	requestId: number;
	completed: boolean;
	settledTarget?: SidebarSelectionTarget;
};

function sameSelection(left: SidebarSelectionTarget | null, right: SidebarSelectionTarget | null): boolean {
	if (!left || !right) return left === right;
	if (left.kind === "conversation" && right.kind === "conversation") return left.path === right.path;
	if (left.kind === "agent-team" && right.kind === "agent-team") return left.sessionId === right.sessionId;
	return false;
}

function isSelectionTarget(value: unknown): value is SidebarSelectionTarget {
	if (typeof value !== "object" || value === null || !("kind" in value)) return false;
	if (value.kind === "conversation") return "path" in value && typeof value.path === "string";
	return value.kind === "agent-team" && "sessionId" in value && typeof value.sessionId === "string";
}

export function useSidebarSelectionIntent(settledSelection: SidebarSelectionTarget | null): {
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
				completed: false,
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
					(result) => {
						if (currentIntentRef.current?.requestId !== request.requestId) return;
						if (result === false) {
							finishSelection(request.requestId);
							return;
						}
						const completed = {
							...currentIntentRef.current,
							completed: true,
							settledTarget: isSelectionTarget(result) ? result : selection,
						};
						currentIntentRef.current = completed;
						setSelectionIntent(completed);
					},
					() => finishSelection(request.requestId),
				);
			});
		},
		[finishSelection],
	);

	useEffect(() => {
		if (
			selectionIntent?.completed &&
			sameSelection(selectionIntent.settledTarget ?? selectionIntent, settledSelection)
		) {
			finishSelection(selectionIntent.requestId);
		}
	}, [finishSelection, selectionIntent, settledSelection]);

	useEffect(
		() => () => {
			currentIntentRef.current = null;
		},
		[],
	);

	return { selectionIntent, selectAfterPaint };
}
