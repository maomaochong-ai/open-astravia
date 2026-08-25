import type { KanbanBoard } from "./types";
import { findCard } from "./board-store";

/**
 * 「草稿 → 待认领」的后悔窗口（纯逻辑层）。
 *
 * 标为待认领是有真实后果的动作：自动认领开着时它会立刻花钱开工。所以不直接改
 * 板数据，而是先记一个到期时间，倒计时内板上仍是草稿——agent 读板、自动认领
 * 都看不到它，点击撤回只需把条目删掉，不需要回滚任何已发生的副作用。
 *
 * 状态是 `cardId → 到期时间戳` 的不可变 Map；所有函数返回新 Map，方便直接放进
 * React state 并做引用比较。
 */

export const PENDING_READY_MS = 5_000;

export type PendingReadyMap = ReadonlyMap<string, number>;

export const EMPTY_PENDING_READY: PendingReadyMap = new Map();

export function startPendingReady(map: PendingReadyMap, cardId: string, now: number): PendingReadyMap {
	const next = new Map(map);
	next.set(cardId, now + PENDING_READY_MS);
	return next;
}

export function cancelPendingReady(map: PendingReadyMap, cardId: string): PendingReadyMap {
	if (!map.has(cardId)) return map;
	const next = new Map(map);
	next.delete(cardId);
	return next;
}

/** 已到期、该真正标为待认领的卡片 id。 */
export function duePendingReady(map: PendingReadyMap, now: number): string[] {
	return [...map.entries()].filter(([, readyAt]) => readyAt <= now).map(([cardId]) => cardId);
}

/** 到期剩余整秒数（向上取整，倒计时显示「5→1」而不是「4→0」）。未挂起返回 null。 */
export function pendingReadySeconds(map: PendingReadyMap, cardId: string, now: number): number | null {
	const readyAt = map.get(cardId);
	if (readyAt === undefined) return null;
	return Math.max(1, Math.ceil((readyAt - now) / 1000));
}

/**
 * 剔除已经不成立的挂起项：卡片被删、被拖出灵感池、或已经被别处（agent 工具）标为
 * 待认领。不剔除的话，到期回调会把一张已经不在灵感池的卡片改回去。
 */
export function prunePendingReady(map: PendingReadyMap, board: KanbanBoard): PendingReadyMap {
	let next: Map<string, number> | null = null;
	for (const cardId of map.keys()) {
		const card = findCard(board, cardId);
		const valid = card !== undefined && card.lane === "inbox" && card.ideaState === "draft";
		if (valid) continue;
		next ??= new Map(map);
		next.delete(cardId);
	}
	return next ?? map;
}
