import type { PluginNavBadge } from "@vetta-org/plugin-sdk";
import { occupyingCards } from "./dispatch";
import type { KanbanBoard } from "./types";

/**
 * 侧边栏「看板」入口上的角标。
 *
 * 一个导航项只有一个角标位，所以两件事要分优先级：**有任务在跑就报数量**，
 * 空闲时退回 `beta` 标识。数量是此刻正在发生的事，比「这个功能还是 Beta」更值得
 * 占用那个位置；而任务清零后 Beta 标识自己回来，不需要额外处理。
 *
 * 计数用 `occupyingCards`（已派单但还没交付）而不是 doing 泳道的卡片总数——那是
 * 板上并发名额环 `n/5` 的同一个口径。换个口径的话，侧边栏说 3 而板上说 5，用户
 * 没法判断哪个是真的。
 */
export function boardNavBadge(board: KanbanBoard): PluginNavBadge {
	const count = occupyingCards(board).length;
	return count > 0 ? { kind: "count", count } : { kind: "beta" };
}
