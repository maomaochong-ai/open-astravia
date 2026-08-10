/** 看板泳道。三条固定泳道，不支持自定义——看板的价值在于「一眼看懂」。 */
export type KanbanLane = "inbox" | "doing" | "review";

export const KANBAN_LANES: readonly KanbanLane[] = ["inbox", "doing", "review"];

/**
 * 灵感池内的两种状态：
 * - `draft`（草稿）：用户还在打磨，**agent 不得认领**。
 * - `ready`（待认领）：需求已说清楚，agent 可以自行派单。
 */
export type KanbanIdeaState = "draft" | "ready";

/**
 * 卡片的执行态。与会话运行态不是一回事：`running` 是「宿主报告这个会话正在
 * agent loop 里」，`queued` 是「已派单但还没轮到 / 还没开跑」，`waiting` 是
 * 「会话存在但当前空闲」（通常意味着 agent 停下来等人，或一轮已经结束）。
 */
export type KanbanRunState = "queued" | "running" | "waiting" | "done" | "failed";

export interface KanbanCard {
	id: string;
	title: string;
	/** 需求正文；派单时作为首轮 prompt 的主体。 */
	detail: string;
	lane: KanbanLane;
	/** 仅 `lane === "inbox"` 时有意义。 */
	ideaState: KanbanIdeaState;
	/** 目标项目目录；空串表示用看板默认项目。 */
	cwd: string;
	/** 0 = 低，1 = 中，2 = 高。派单时高优先级先走。 */
	priority: 0 | 1 | 2;
	tags: string[];
	/** 依赖的卡片 id：这些卡片没进「待检查」之前不可派单。 */
	dependsOn: string[];
	sessionId?: string;
	sessionPath?: string;
	runState?: KanbanRunState;
	/** 谁把它推进「正在处理」的。 */
	claimedBy?: "agent" | "user";
	/** 交付说明（agent 提交到「待检查」时写入）。 */
	deliveryNote?: string;
	/** 最近一次失败原因。 */
	error?: string;
	createdAt: number;
	updatedAt: number;
	/** 泳道内排序键，越小越靠前。 */
	order: number;
}

export interface KanbanBoard {
	version: 1;
	/** 「正在处理」泳道的 WIP 上限。**只约束本看板**，不影响宿主其它地方的并发。 */
	concurrency: number;
	/** 未指定 cwd 的卡片落到这个项目。 */
	defaultCwd: string;
	cards: KanbanCard[];
}

export const DEFAULT_CONCURRENCY = 5;
export const MIN_CONCURRENCY = 1;
export const MAX_CONCURRENCY = 20;

export function createEmptyBoard(defaultCwd = ""): KanbanBoard {
	return { version: 1, concurrency: DEFAULT_CONCURRENCY, defaultCwd, cards: [] };
}
