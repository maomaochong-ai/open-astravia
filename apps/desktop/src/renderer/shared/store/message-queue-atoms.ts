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
	kind: "message" | "context_compaction";
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
