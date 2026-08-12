import { useCallback, useEffect, useRef } from "react";
import type { PetActionId } from "../../../../shared/pet-actions";

export const PET_APP_PRESENTATION_MIN_HOLD_MS = 2_000;

export type PetAppActionUpdate = { type: "set"; actionId: PetActionId } | { type: "random" };

interface LatestHeldQueueOptions<T> {
	minHoldMs: number;
	canApply?: () => boolean;
	apply: (value: T) => void;
}

interface PetPresentationThrottleOptions {
	minHoldMs?: number;
	canApplyAction: () => boolean;
	applyAction: (update: PetAppActionUpdate) => void;
	onActionQueued?: (update: PetAppActionUpdate) => void;
}

function useLatestHeldQueue<T>({ minHoldMs, canApply, apply }: LatestHeldQueueOptions<T>): {
	queue: (value: T) => void;
	clear: () => void;
} {
	const holdUntilRef = useRef(0);
	const timerRef = useRef<number | undefined>(undefined);
	const pendingRef = useRef<T | undefined>(undefined);
	const minHoldMsRef = useRef(minHoldMs);
	const canApplyRef = useRef(canApply);
	const applyRef = useRef(apply);
	const scheduleRef = useRef<() => void>(() => undefined);

	minHoldMsRef.current = minHoldMs;
	canApplyRef.current = canApply;
	applyRef.current = apply;

	const clear = useCallback(() => {
		if (timerRef.current != null) {
			window.clearTimeout(timerRef.current);
			timerRef.current = undefined;
		}
		pendingRef.current = undefined;
		holdUntilRef.current = 0;
	}, []);

	const canApplyNow = useCallback(() => canApplyRef.current?.() ?? true, []);

	const schedule = useCallback(() => {
		if (timerRef.current != null) {
			window.clearTimeout(timerRef.current);
		}
		const delay = Math.max(0, holdUntilRef.current - Date.now());
		timerRef.current = window.setTimeout(() => {
			timerRef.current = undefined;
			const pending = pendingRef.current;
			pendingRef.current = undefined;
			if (!pending || !canApplyNow()) {
				holdUntilRef.current = 0;
				return;
			}
			applyRef.current(pending);
			holdUntilRef.current = Date.now() + minHoldMsRef.current;
			scheduleRef.current();
		}, delay);
	}, [canApplyNow]);

	scheduleRef.current = schedule;

	const queue = useCallback(
		(value: T) => {
			if (!canApplyNow()) return;
			if (Date.now() < holdUntilRef.current) {
				pendingRef.current = value;
				if (timerRef.current == null) {
					scheduleRef.current();
				}
				return;
			}
			pendingRef.current = undefined;
			applyRef.current(value);
			holdUntilRef.current = Date.now() + minHoldMsRef.current;
			scheduleRef.current();
		},
		[canApplyNow],
	);

	useEffect(() => clear, [clear]);

	return { queue, clear };
}

export function usePetPresentationThrottle({
	minHoldMs = PET_APP_PRESENTATION_MIN_HOLD_MS,
	canApplyAction,
	applyAction,
	onActionQueued,
}: PetPresentationThrottleOptions): {
	queueAppAction: (update: PetAppActionUpdate) => void;
	clearPresentationThrottle: () => void;
} {
	const actionQueue = useLatestHeldQueue({
		minHoldMs,
		canApply: canApplyAction,
		apply: applyAction,
	});
	const queueAppAction = useCallback(
		(update: PetAppActionUpdate) => {
			onActionQueued?.(update);
			actionQueue.queue(update);
		},
		[actionQueue.queue, onActionQueued],
	);

	const clearPresentationThrottle = useCallback(() => {
		actionQueue.clear();
	}, [actionQueue.clear]);

	return {
		queueAppAction,
		clearPresentationThrottle,
	};
}
