/**
 * 失败重发去重的判据（ADR-0060 第 5 条）。
 *
 * ADR 里这条回退只针对「prompt 前置失败」：intercept/prepare 抛错或同步校验不过，
 * turn 根本没跑起来，用户消息却已落盘。这种空转记录删掉是安全的，重发才不会在
 * jsonl 和模型上下文里留下两条相同的 user 消息。
 *
 * 判据必须收得比「上一条 agent 消息带 error」更紧，因为后端的 `user_turn.replace`
 * 是**硬删除该 entry 及其整棵子树**（`packages/runtime-core/src/conversation/commands.ts`
 * 的 `replaceLastUserTurn`）。一旦命中的是「跑了很久才失败」的一轮——例如中途撞上
 * 402 配额耗尽——这一轮所有工具调用与产出会被一起抹掉，且不可恢复。
 *
 * 所以这里额外要求：出错的 agent 消息**紧邻**那条用户消息，且除 error 块外没有
 * 任何实质产出。两者任一不满足，就按普通追加发送——宁可重复也不丢历史。
 */
import type { ChatConversationItem } from "@shared/store/atoms";

export interface FailedResendRollbackPlan {
	/** 要回退（连同子树删除）的用户消息 entry。 */
	readonly entryId: string;
	/** 渲染端截断位置：该用户消息在列表中的下标。 */
	readonly truncateFrom: number;
}

/**
 * 判断本次发送是否是一次「对空转失败轮的原样重发」。
 *
 * @param messages 当前会话的渲染消息列表
 * @param text 本次要发送的文本
 * @returns 可以回退时返回计划，否则返回 null
 */
export function planFailedResendRollback(
	messages: readonly ChatConversationItem[],
	text: string,
): FailedResendRollbackPlan | null {
	const lastIndex = messages.length - 1;
	const failed = messages[lastIndex];
	if (failed?.kind !== "agent") return null;

	// 只认「纯错误」的 agent 消息：有 error 块，且没有文本、工具调用等任何实质产出。
	// 有产出就说明这一轮真干过活，删掉它等于销毁用户的工作成果。
	if (failed.blocks.length === 0) return null;
	if (!failed.blocks.every((block) => block.type === "error")) return null;
	if (failed.text && failed.text.trim().length > 0) return null;

	// 必须紧邻。中间隔了任何东西（更早的轮次、压缩事件、plan review 卡片）都说明
	// 这条用户消息并不是本次失败的那一次输入，回退会越界删除。
	const userIndex = lastIndex - 1;
	const lastUser = messages[userIndex];
	if (lastUser?.kind !== "user") return null;
	if (!lastUser.entryId) return null;
	if (lastUser.text !== text) return null;

	return { entryId: lastUser.entryId, truncateFrom: userIndex };
}
