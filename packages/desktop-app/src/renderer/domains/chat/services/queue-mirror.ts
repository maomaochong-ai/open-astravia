import type { QueuedMessage } from "@shared/store/message-queue-atoms";

/**
 * kernel 队列镜像的差分逻辑（ADR-0060）。
 *
 * 排队消息被 turn 消费时（followUp 自然停止点接力 / steering 工具间隙注入 /
 * sendNow 空闲直发），kernel 只发一条 queue.changed（条目消失），user 消息本身
 * 不再有独立事件。渲染端据「消失且非本端主动移除」判定为已消费，补上用户气泡；
 * 乐观对账在 agent_end 重拉时按文本吸收它，不产生重复。
 */

/** 本端主动移除（队列抽屉删除）的条目 id：先记账再发 IPC，避免 queue.changed 先到。 */
const selfRemovedIds = new Set<string>();

export function markQueueEntrySelfRemoved(id: string): void {
	selfRemovedIds.add(id);
}

/** 找出 prev 中消失于 next、且不是本端主动移除的条目 = 已被 turn 消费。 */
export function diffConsumedQueueEntries(
	prev: readonly QueuedMessage[],
	next: readonly QueuedMessage[],
): QueuedMessage[] {
	const nextIds = new Set(next.map((entry) => entry.id));
	const consumed: QueuedMessage[] = [];
	for (const entry of prev) {
		if (nextIds.has(entry.id)) continue;
		if (selfRemovedIds.delete(entry.id)) continue;
		consumed.push(entry);
	}
	return consumed;
}

/** 仅测试用：清空本端移除记账。 */
export function resetQueueMirrorStateForTest(): void {
	selfRemovedIds.clear();
}
