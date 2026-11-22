import type { ChatConversationItem, PendingMessageEdit } from "@shared/store/atoms";

/**
 * 判断「编辑最后一条消息」的待提交状态是否仍然成立。
 *
 * 编辑态是一个全局 atom，只有它自己会被取消；而它引用的 `entryId` 属于某一条具体消息。
 * 切会话、消息被替换、分支切换、历史重载之后，这个 entryId 可能已经不存在、或指向别处。
 * 此时若照旧执行替换：轻则把当前会话最后一轮问答删掉（用户没打算编辑），重则替换失败、
 * 发送直接 return，用户看到「正在编辑最后一条消息」且新消息永远发不出去。
 *
 * 因此发送前只接受「entryId 正好是当前 feed 里最后一条用户消息」的编辑态，其余一律作废。
 */
export function resolvePendingMessageEdit(
	messages: readonly ChatConversationItem[],
	pending: PendingMessageEdit | null,
): PendingMessageEdit | null {
	if (!pending) return null;
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		const item = messages[index];
		if (item?.kind !== "user") continue;
		// 找到最后一条用户消息就停：只有它可以被「编辑并替换」。
		return item.entryId === pending.entryId ? pending : null;
	}
	// feed 里还没有任何用户消息：不可能正在编辑某一条，同样视为陈旧状态。
	return null;
}
