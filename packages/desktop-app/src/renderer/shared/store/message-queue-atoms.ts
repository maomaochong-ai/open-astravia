import { atom } from "jotai";

/**
 * kernel 输入队列的渲染端镜像条目（ADR-0060）。队列唯一属主是主进程 kernel 的
 * SessionInputQueue；渲染端只消费 queue.changed 事件与 getQueueState 快照，
 * 所有修改（移除/重排/立即发送/继续/清空）都走 IPC 回 kernel。
 */
export interface QueuedMessage {
	id: string;
	displayText: string;
	behavior: "steer" | "followUp";
}

/** Map<runtimeId, QueuedMessage[]>，按 session 的 runtimeId 隔离的队列镜像。 */
export const messageQueueBySessionAtom = atom<Map<string, QueuedMessage[]>>(new Map());

/** abort/error 后 kernel 队列进入 paused（pause-on-terminal），UI 据此提示「继续发送」。 */
export const messageQueuePausedBySessionAtom = atom<Map<string, boolean>>(new Map());

export function getQueueForSession(
	map: Map<string, QueuedMessage[]>,
	runtimeId: string | null | undefined,
): QueuedMessage[] {
	if (!runtimeId) return [];
	return map.get(runtimeId) ?? [];
}

export function isQueuePausedForSession(map: Map<string, boolean>, runtimeId: string | null | undefined): boolean {
	if (!runtimeId) return false;
	return map.get(runtimeId) ?? false;
}

export const setQueueForSessionAtom = atom(
	null,
	(get, set, { runtimeId, items }: { runtimeId: string; items: QueuedMessage[] }) => {
		const prev = get(messageQueueBySessionAtom);
		const next = new Map(prev);
		if (items.length === 0) next.delete(runtimeId);
		else next.set(runtimeId, items);
		set(messageQueueBySessionAtom, next);
	},
);

export const setQueuePausedAtom = atom(
	null,
	(get, set, { runtimeId, paused }: { runtimeId: string; paused: boolean }) => {
		const prev = get(messageQueuePausedBySessionAtom);
		if ((prev.get(runtimeId) ?? false) === paused) return;
		const next = new Map(prev);
		if (paused) next.set(runtimeId, true);
		else next.delete(runtimeId);
		set(messageQueuePausedBySessionAtom, next);
	},
);

export const clearQueueAtom = atom(null, (get, set, runtimeId: string) => {
	const prev = get(messageQueueBySessionAtom);
	if (prev.has(runtimeId)) {
		const next = new Map(prev);
		next.delete(runtimeId);
		set(messageQueueBySessionAtom, next);
	}
	const prevPaused = get(messageQueuePausedBySessionAtom);
	if (prevPaused.has(runtimeId)) {
		const nextPaused = new Map(prevPaused);
		nextPaused.delete(runtimeId);
		set(messageQueuePausedBySessionAtom, nextPaused);
	}
});

/**
 * 队列派发序号：每当一条排队消息作为新一轮 prompt 真正发出时 +1。
 *
 * agent_end 会异步 getFullHistory 后整体替换消息列表以回填 entryId。当某回合结束的同一
 * 时机（或结束后）发生了队列派发，这个整体替换就「跨到了下一轮」：mapped 可能已含下一条
 * 用户消息（→ 与乐观气泡重复），也可能尚不含（→ 冲掉乐观气泡并令 draft 串台）。
 *
 * 判活办法：每轮在 agent_start 记录当时序号；该轮 agent_end 的重拉落地时若序号已变，说明
 * 发生过队列派发 → 跳过这次过期替换，交由下一轮自己的 agent_end 在无重叠时安全重拉。
 * 纯内存，按 runtimeId 隔离，app 重启清空。
 */
const queuedDispatchSeqBySession = new Map<string, number>();

export function bumpQueuedDispatchSeq(runtimeId: string): void {
	queuedDispatchSeqBySession.set(runtimeId, (queuedDispatchSeqBySession.get(runtimeId) ?? 0) + 1);
}

export function getQueuedDispatchSeq(runtimeId: string): number {
	return queuedDispatchSeqBySession.get(runtimeId) ?? 0;
}
