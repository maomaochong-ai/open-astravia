import type { PluginNavBadge } from "@vetta-org/plugin-sdk";
import { laneCards } from "./board-store";
import { occupyingCards } from "./dispatch";
import type { KanbanBoard } from "./types";

/**
 * 侧边栏「看板」入口上的角标。
 *
 * 一个导航项只有一个角标位，按「需要用户做什么」分优先级：
 * 1. **待检查有交付**：这是唯一等着用户亲自动手的事（验收 / 打回），用红色实心
 *    计数（`tone: "danger"`）当未读角标——不点掉它不会自己消失。
 * 2. **有任务在跑**：信息性计数，默认色；任务清零自动让位。
 * 3. 都没有：退回 `beta` 标识。
 *
 * 运行计数用 `occupyingCards`（已派单但还没交付）——与板上并发名额环 `n/5` 同一
 * 口径。换个口径的话，侧边栏说 3 而板上说 5，用户没法判断哪个是真的。
 */
export function boardNavBadge(board: KanbanBoard): PluginNavBadge {
	const unread = laneCards(board, "review").length;
	if (unread > 0) return { kind: "count", count: unread, tone: "danger" };
	const running = occupyingCards(board).length;
	return running > 0 ? { kind: "count", count: running } : { kind: "beta" };
}
