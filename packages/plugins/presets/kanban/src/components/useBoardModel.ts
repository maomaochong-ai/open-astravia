import { useCallback, useEffect, useMemo, useState } from "react";
import type { KanbanBoardController, KanbanModelOption, KanbanSkillOption } from "../board/board-controller";
import { archivedCards, laneCards, matchesQuery } from "../board/board-store";
import { remainingSlots, unmetDependencies } from "../board/dispatch";
import type { KanbanBoard, KanbanCard, KanbanLane } from "../board/types";

export interface BoardLaneView {
	lane: KanbanLane;
	cards: KanbanCard[];
}

export interface BoardModel {
	board: KanbanBoard;
	loading: boolean;
	/** 已按搜索词过滤的泳道内容。 */
	lanes: Record<KanbanLane, KanbanCard[]>;
	/** 未过滤的各泳道总数（搜索时列头仍显示真实数量）。 */
	laneTotals: Record<KanbanLane, number>;
	archived: KanbanCard[];
	/** 可选模型；面板挂载时刷新一次，所以开着看板去登录 / 加 provider 后回来就能看到。 */
	models: KanbanModelOption[];
	/** 正文可 `@` 提及的技能；同样每次挂载刷新。 */
	skills: KanbanSkillOption[];
	/** 宿主全局默认模型的 key。 */
	hostDefaultModelKey: string;
	remainingSlots: number;
	/** cardId → 未完成依赖的卡片标题，用于卡片上直接显示「被谁挡着」。 */
	blockedBy: Record<string, string[]>;
	controller: KanbanBoardController;
	query: string;
	setQuery: (query: string) => void;
	/** 相对时间基准，30s 一跳，避免每张卡各自起 interval。 */
	now: number;
	refresh: () => void;
}

/**
 * 把 controller 的推送接到 React。controller 是真相源，这里只做订阅 + 重渲染，
 * 不复制状态——否则 agent 侧的变更和 UI 侧的变更会各自漂移。
 */
export function useBoardModel(controller: KanbanBoardController): BoardModel {
	const [board, setBoard] = useState<KanbanBoard>(() => controller.getBoard());
	const [loading, setLoading] = useState(true);
	const [query, setQuery] = useState("");
	const [now, setNow] = useState(() => Date.now());
	const [models, setModels] = useState<KanbanModelOption[]>(() => controller.getModels());
	const [skills, setSkills] = useState<KanbanSkillOption[]>(() => controller.getSkills());
	const [hostDefaultModelKey, setHostDefaultModelKey] = useState(() => controller.getHostDefaultModelKey());

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
		// 与 board 分开刷：模型清单不是看板数据，且远程目录（Vetta Go）随登录态变化。
		void controller.refreshModels().then((next) => {
			if (cancelled) return;
			setModels(next);
			setHostDefaultModelKey(controller.getHostDefaultModelKey());
		});
		void controller.refreshSkills().then((next) => {
			if (!cancelled) setSkills(next);
		});
		return () => {
			cancelled = true;
			unsubscribe();
		};
	}, [controller]);

	useEffect(() => {
		const timer = setInterval(() => setNow(Date.now()), 30_000);
		return () => clearInterval(timer);
	}, []);

	const allLanes = useMemo(
		() => ({
			inbox: laneCards(board, "inbox"),
			doing: laneCards(board, "doing"),
			review: laneCards(board, "review"),
		}),
		[board],
	);
	const laneTotals = useMemo(
		() => ({ inbox: allLanes.inbox.length, doing: allLanes.doing.length, review: allLanes.review.length }),
		[allLanes],
	);
	const lanes = useMemo(() => {
		if (!query.trim()) return allLanes;
		return {
			inbox: allLanes.inbox.filter((card) => matchesQuery(card, query)),
			doing: allLanes.doing.filter((card) => matchesQuery(card, query)),
			review: allLanes.review.filter((card) => matchesQuery(card, query)),
		};
	}, [allLanes, query]);
	const archived = useMemo(() => archivedCards(board), [board]);

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

	return {
		board,
		loading,
		lanes,
		laneTotals,
		archived,
		models,
		skills,
		hostDefaultModelKey,
		remainingSlots: remainingSlots(board),
		blockedBy,
		controller,
		query,
		setQuery,
		now,
		refresh,
	};
}
