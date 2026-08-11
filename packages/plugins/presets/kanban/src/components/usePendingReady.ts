import { useCallback, useEffect, useRef, useState } from "react";
import type { KanbanBoardController } from "../board/board-controller";
import {
	cancelPendingReady,
	duePendingReady,
	EMPTY_PENDING_READY,
	pendingReadySeconds,
	prunePendingReady,
	startPendingReady,
	type PendingReadyMap,
} from "../board/pending-ready";
import type { KanbanBoard } from "../board/types";

export interface PendingReadyModel {
	/** 挂起中卡片的剩余整秒数；未挂起返回 null。 */
	secondsFor: (cardId: string) => number | null;
	start: (cardId: string) => void;
	cancel: (cardId: string) => void;
	/** 立即把挂起兑现为待认领（拖拽直接派发等显式动作不需要再等倒计时）。 */
	commitNow: (cardId: string) => void;
}

/**
 * 「草稿 → 待认领」5 秒后悔窗口的 React 接线。纯规则在 board/pending-ready.ts；
 * 这里只负责计时器驱动、到期时调 controller、以及跟着板面变化剔除失效项。
 */
export function usePendingReady(controller: KanbanBoardController, board: KanbanBoard): PendingReadyModel {
	const [pending, setPending] = useState<PendingReadyMap>(EMPTY_PENDING_READY);
	// 倒计时显示要每秒重渲染；单独一个 tick 状态，避免把 now 塞进 pending Map。
	const [, setTick] = useState(0);
	const pendingRef = useRef(pending);
	pendingRef.current = pending;

	// 板面变化（卡片被删 / 拖走 / 被 agent 工具改状态）时剔除失效挂起项。
	useEffect(() => {
		setPending((prev) => prunePendingReady(prev, board));
	}, [board]);

	useEffect(() => {
		if (pending.size === 0) return;
		const timer = setInterval(() => {
			const due = duePendingReady(pendingRef.current, Date.now());
			if (due.length > 0) {
				setPending((prev) => due.reduce((map, cardId) => cancelPendingReady(map, cardId), prev));
				for (const cardId of due) controller.setIdeaState(cardId, "ready");
			}
			setTick((value) => value + 1);
		}, 250);
		return () => clearInterval(timer);
	}, [controller, pending.size]);

	const secondsFor = useCallback((cardId: string) => pendingReadySeconds(pending, cardId, Date.now()), [pending]);

	const start = useCallback((cardId: string) => {
		setPending((prev) => startPendingReady(prev, cardId, Date.now()));
	}, []);

	const cancel = useCallback((cardId: string) => {
		setPending((prev) => cancelPendingReady(prev, cardId));
	}, []);

	const commitNow = useCallback(
		(cardId: string) => {
			if (!pendingRef.current.has(cardId)) return;
			setPending((prev) => cancelPendingReady(prev, cardId));
			controller.setIdeaState(cardId, "ready");
		},
		[controller],
	);

	return { secondsFor, start, cancel, commitNow };
}
