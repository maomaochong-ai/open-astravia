import { findCard, laneCards, resolveCardCwd, resolveCardModelKey } from "./board-store";
import type { KanbanBoard, KanbanCard } from "./types";

/**
 * 派单规则（WIP 闸门 + 依赖顺序）。
 *
 * 这层刻意不做「自动派单」：谁先做、能不能并行、要不要等前一个做完，全部由
 * agent 自己在对话里决定，看板只负责**否决**违反约束的派单请求，并告诉 agent
 * 现在还剩几个名额、哪些卡被依赖挡住了。
 */

/** 占用「正在处理」名额的执行态：已派单但还没交付的都算在内。 */
const OCCUPYING_RUN_STATES = new Set(["queued", "running", "waiting"]);

/** 当前占用 WIP 名额的卡片。 */
export function occupyingCards(board: KanbanBoard): KanbanCard[] {
	return laneCards(board, "doing").filter(
		(card) => card.runState === undefined || OCCUPYING_RUN_STATES.has(card.runState),
	);
}

/** 「正在处理」还剩几个名额（不会为负）。 */
export function remainingSlots(board: KanbanBoard): number {
	return Math.max(0, board.concurrency - occupyingCards(board).length);
}

export type DispatchRefusal =
	| { reason: "not-found" }
	| { reason: "not-in-inbox"; lane: KanbanCard["lane"] }
	| { reason: "draft" }
	| { reason: "wip-full"; concurrency: number }
	| { reason: "blocked"; blockedBy: string[] }
	| { reason: "missing-cwd" }
	/** 闸门放行了，但建会话 / 发 prompt 失败（网络、运行时等）。 */
	| { reason: "session-error"; message: string };

export type DispatchDecision =
	/** `modelKey` 为空串 = 不指定模型，交给宿主的全局默认。 */
	| { ok: true; card: KanbanCard; cwd: string; modelKey: string }
	| ({ ok: false } & DispatchRefusal);

/**
 * 未满足的依赖：被依赖卡片只要还没进「待检查」就算未完成（被删掉的依赖在
 * removeCard 时已清理，这里不会误挡）。
 */
export function unmetDependencies(board: KanbanBoard, card: KanbanCard): string[] {
	return card.dependsOn.filter((id) => {
		const dependency = findCard(board, id);
		return dependency !== undefined && dependency.lane !== "review";
	});
}

/**
 * 能否把某张灵感池卡片推进「正在处理」。拒绝时给出**可执行的**理由，
 * 让 agent 知道是该等（wip-full / blocked）还是该放弃（draft / not-found）。
 */
export function canDispatch(board: KanbanBoard, cardId: string): DispatchDecision {
	const card = findCard(board, cardId);
	if (!card) return { ok: false, reason: "not-found" };
	if (card.lane !== "inbox") return { ok: false, reason: "not-in-inbox", lane: card.lane };
	if (card.ideaState !== "ready") return { ok: false, reason: "draft" };
	const blockedBy = unmetDependencies(board, card);
	if (blockedBy.length > 0) return { ok: false, reason: "blocked", blockedBy };
	if (remainingSlots(board) <= 0) return { ok: false, reason: "wip-full", concurrency: board.concurrency };
	const cwd = card.cwd.trim() || board.defaultCwd.trim();
	if (!cwd) return { ok: false, reason: "missing-cwd" };
	return { ok: true, card, cwd, modelKey: resolveCardModelKey(board, card) };
}

/**
 * 建议派单顺序：可立即派的待认领卡片，按优先级降序、其次创建时间升序。
 * 只是**建议**——agent 可以另选，闸门仍由 {@link canDispatch} 兜底。
 */
export function dispatchableCards(board: KanbanBoard): KanbanCard[] {
	return laneCards(board, "inbox")
		.filter((card) => card.ideaState === "ready" && unmetDependencies(board, card).length === 0)
		.sort((left, right) => right.priority - left.priority || left.createdAt - right.createdAt);
}

/**
 * 自动认领该派哪些卡片：按建议顺序取，最多填满剩余名额。
 *
 * 与 {@link dispatchableCards} 的差别是这里还要求 cwd 可解析——自动循环没有人盯着，
 * 派不出去的卡片会被反复重试，所以先在规则层排掉必然失败的那类。
 * 关闭自动认领时返回空数组：这层就是开关的唯一判定处，调用方不必再判一遍。
 */
export function autoClaimCandidates(board: KanbanBoard): KanbanCard[] {
	if (!board.autoClaim) return [];
	return dispatchableCards(board)
		.filter((card) => resolveCardCwd(board, card) !== "")
		.slice(0, remainingSlots(board));
}

/** 因依赖未完成而暂时派不出去的待认领卡片。 */
export function blockedCards(board: KanbanBoard): Array<{ card: KanbanCard; blockedBy: string[] }> {
	return laneCards(board, "inbox")
		.filter((card) => card.ideaState === "ready")
		.map((card) => ({ card, blockedBy: unmetDependencies(board, card) }))
		.filter((entry) => entry.blockedBy.length > 0);
}

/**
 * 派给会话的首轮 prompt。带上卡片标题、正文与看板回执要求——agent 做完后需要
 * 主动调 `kanban_submit_task` 把卡片推进「待检查」，否则卡片会一直占着名额。
 */
export function buildDispatchPrompt(card: KanbanCard): string {
	const lines = [`# ${card.title}`];
	if (card.detail.trim()) lines.push("", card.detail.trim());
	if (card.tags.length > 0) lines.push("", `标签：${card.tags.join("、")}`);
	lines.push(
		"",
		"---",
		`这条任务来自看板卡片 \`${card.id}\`。完成后调用 \`kanban_submit_task\` 把它提交到「待检查」，并在 \`note\` 里写清交付了什么、有哪些已知风险。`,
		"如果需求不清楚导致无法开工，同样调用 `kanban_submit_task` 并在 `note` 中说明缺什么。",
	);
	return lines.join("\n");
}

/**
 * 打回重做的反馈 prompt。发往**原会话**——上下文都在那里，agent 不需要从头理解需求，
 * 只需要按反馈修正。仍要求完成后再次 `kanban_submit_task`。
 */
export function buildSendBackPrompt(card: KanbanCard, feedback: string): string {
	const lines = [
		`看板卡片 \`${card.id}\`（${card.title}）的交付未通过验收，已退回「正在处理」。`,
		"",
		"用户的反馈：",
		feedback.trim(),
	];
	if (card.deliveryNote?.trim()) {
		lines.push("", "你上一轮的交付说明（供对照）：", card.deliveryNote.trim());
	}
	lines.push("", "请按反馈修正。完成后再次调用 `kanban_submit_task` 提交到「待检查」，并在 `note` 里说明这一轮改了什么。");
	return lines.join("\n");
}

/** 给 agent 的看板快照：只含决策需要的信息，不把整块板灌进上下文。 */
export interface BoardSnapshotForAgent {
	concurrency: number;
	remainingSlots: number;
	/** 看板是否在自动认领。开着时 `ready` 里的卡片会被看板自己派走，你不必再抢着认领。 */
	autoClaim: boolean;
	/** 看板默认模型；缺省（未选）时不出现，表示派单跟随宿主全局默认模型。 */
	defaultModelKey?: string;
	doing: Array<{ id: string; title: string; runState?: string; sessionPath?: string }>;
	review: Array<{ id: string; title: string; deliveryNote?: string }>;
	ready: Array<{ id: string; title: string; priority: number; blockedBy: string[]; cwd: string; modelKey?: string }>;
	draftCount: number;
}

export function snapshotForAgent(board: KanbanBoard): BoardSnapshotForAgent {
	const inbox = laneCards(board, "inbox");
	return {
		concurrency: board.concurrency,
		remainingSlots: remainingSlots(board),
		autoClaim: board.autoClaim,
		...(board.defaultModelKey.trim() ? { defaultModelKey: board.defaultModelKey.trim() } : {}),
		doing: laneCards(board, "doing").map((card) => ({
			id: card.id,
			title: card.title,
			...(card.runState ? { runState: card.runState } : {}),
			...(card.sessionPath ? { sessionPath: card.sessionPath } : {}),
		})),
		review: laneCards(board, "review").map((card) => ({
			id: card.id,
			title: card.title,
			...(card.deliveryNote ? { deliveryNote: card.deliveryNote } : {}),
		})),
		ready: inbox
			.filter((card) => card.ideaState === "ready")
			.map((card) => ({
				id: card.id,
				title: card.title,
				priority: card.priority,
				blockedBy: unmetDependencies(board, card),
				cwd: card.cwd.trim() || board.defaultCwd.trim(),
				...(resolveCardModelKey(board, card) ? { modelKey: resolveCardModelKey(board, card) } : {}),
			})),
		draftCount: inbox.filter((card) => card.ideaState === "draft").length,
	};
}
