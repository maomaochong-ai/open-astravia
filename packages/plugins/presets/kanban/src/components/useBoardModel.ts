import { useCallback, useEffect, useMemo, useState } from "react";
import type { KanbanBoardController } from "../board/board-controller";
import { laneCards } from "../board/board-store";
import { remainingSlots, unmetDependencies } from "../board/dispatch";
import type { KanbanBoard, KanbanCard, KanbanLane } from "../board/types";

export interface BoardLaneView {
	lane: KanbanLane;
	cards: KanbanCard[];
}

export interface BoardModel {
	board: KanbanBoard;
	loading: boolean;
	lanes: Record<KanbanLane, KanbanCard[]>;
	remainingSlots: number;
	/** cardId → 未完成依赖的卡片标题，用于卡片上直接显示「被谁挡着」。 */
	blockedBy: Record<string, string[]>;
	controller: KanbanBoardController;
	refresh: () => void;
}

/**
 * 把 controller 的推送接到 React。controller 是真相源，这里只做订阅 + 重渲染，
 * 不复制状态——否则 agent 侧的变更和 UI 侧的变更会各自漂移。
 */
export function useBoardModel(controller: KanbanBoardController): BoardModel {
	const [board, setBoard] = useState<KanbanBoard>(() => controller.getBoard());
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		let cancelled = false;
		const unsubscribe = controller.subscribe((next) => {
			if (!cancelled) setBoard(next);
		});
		void controller.ensureLoaded().then((next) => {
			if (cancelled) return;
			setBoard(next);
			setLoading(false);
		});
		return () => {
			cancelled = true;
			unsubscribe();
		};
	}, [controller]);

	const lanes = useMemo(
		() => ({
			inbox: laneCards(board, "inbox"),
			doing: laneCards(board, "doing"),
			review: laneCards(board, "review"),
		}),
		[board],
	);

	const blockedBy = useMemo(() => {
		const titleById = new Map(board.cards.map((card) => [card.id, card.title]));
		const result: Record<string, string[]> = {};
		for (const card of board.cards) {
			if (card.dependsOn.length === 0) continue;
			const unmet = unmetDependencies(board, card);
			if (unmet.length > 0) result[card.id] = unmet.map((id) => titleById.get(id) ?? id);
		}
		return result;
	}, [board]);

	const refresh = useCallback(() => setBoard(controller.getBoard()), [controller]);

	return { board, loading, lanes, remainingSlots: remainingSlots(board), blockedBy, controller, refresh };
}
