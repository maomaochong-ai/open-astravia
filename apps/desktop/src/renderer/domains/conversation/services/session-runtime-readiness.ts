import {
	type ActiveSession,
	activeSessionAtom,
	pendingSessionCreationAtom,
	pendingSessionOpenAtom,
} from "@shared/store/atoms";
import { getDefaultStore } from "jotai";

type SessionTransition = { kind: "creation"; interactionId: string } | { kind: "open"; interactionId: string };

function getPendingTransition(): SessionTransition | null {
	const store = getDefaultStore();
	const pendingOpen = store.get(pendingSessionOpenAtom);
	if (pendingOpen) return { kind: "open", interactionId: pendingOpen.interactionId };
	const pendingCreation = store.get(pendingSessionCreationAtom);
	return pendingCreation ? { kind: "creation", interactionId: pendingCreation.interactionId } : null;
}

function transitionStillPending(transition: SessionTransition): boolean {
	const store = getDefaultStore();
	const pending = store.get(transition.kind === "open" ? pendingSessionOpenAtom : pendingSessionCreationAtom);
	return pending?.interactionId === transition.interactionId;
}

/**
 * Returns the Runtime for the session that owned the user interaction.
 *
 * A pending transition is an internal ordering boundary, never a UI permission.
 * Calls made while it exists wait for that exact transition. If a newer open
 * supersedes it, the result is null so the old action cannot leak into the new
 * active session.
 */
export function getSessionRuntimeWhenReady(): Promise<ActiveSession | null> {
	const store = getDefaultStore();
	const transition = getPendingTransition();
	if (!transition) return Promise.resolve(store.get(activeSessionAtom));

	return new Promise((resolve) => {
		let settled = false;
		const unsubscribers: Array<() => void> = [];
		const finish = (session: ActiveSession | null): void => {
			if (settled) return;
			settled = true;
			for (const unsubscribe of unsubscribers) unsubscribe();
			resolve(session);
		};
		const check = (): void => {
			if (transitionStillPending(transition)) return;
			// Another transition means the interaction's original target lost the
			// newest-wins race. Never redirect the operation to that newer target.
			if (getPendingTransition()) {
				finish(null);
				return;
			}
			finish(store.get(activeSessionAtom));
		};

		unsubscribers.push(
			store.sub(activeSessionAtom, check),
			store.sub(pendingSessionCreationAtom, check),
			store.sub(pendingSessionOpenAtom, check),
		);
		check();
	});
}
