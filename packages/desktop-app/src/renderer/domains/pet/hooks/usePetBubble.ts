import { useCallback, useEffect, useReducer } from "react";
import type { PetCommandSource } from "../../../../shared/pet-ipc";
import {
	INITIAL_PET_BUBBLE_QUEUE_STATE,
	PET_BUBBLE_MIN_HOLD_MS,
	type PetBubbleMessage,
	reducePetBubbleQueue,
	type ShowPetBubbleInput,
} from "../services/pet-bubble-state";

export type { ShowPetBubbleInput } from "../services/pet-bubble-state";

export function usePetBubble(): {
	bubble: PetBubbleMessage | undefined;
	showBubble: (input: ShowPetBubbleInput) => void;
	hideBubble: (source?: PetCommandSource) => void;
} {
	const [state, dispatch] = useReducer(reducePetBubbleQueue, INITIAL_PET_BUBBLE_QUEUE_STATE);

	const hideBubble = useCallback(
		(source?: PetCommandSource) =>
			dispatch({ type: "hide", now: Date.now(), ...(source === undefined ? {} : { source }) }),
		[],
	);

	const showBubble = useCallback(
		(input: ShowPetBubbleInput) => dispatch({ type: "show", input, now: Date.now() }),
		[],
	);

	useEffect(() => {
		const current = state.current;
		if (!current || (current.persistent && state.pending.length === 0)) return;
		const elapsedMs = Date.now() - current.shownAt;
		const displayMs = current.persistent
			? PET_BUBBLE_MIN_HOLD_MS
			: state.pending.length > 0
				? Math.min(current.ttlMs, PET_BUBBLE_MIN_HOLD_MS)
				: current.ttlMs;
		const timer = window.setTimeout(
			() => dispatch({ type: "advance", messageId: current.id, now: Date.now() }),
			Math.max(0, displayMs - elapsedMs),
		);
		return () => window.clearTimeout(timer);
	}, [state.current, state.pending.length]);

	return { bubble: state.current, showBubble, hideBubble };
}
