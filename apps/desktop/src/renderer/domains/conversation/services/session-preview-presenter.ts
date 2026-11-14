import type { HistoryEntry } from "@astravia/runtime-core";

/**
 * 打开已有会话时的「两段式首屏」编排。
 *
 * 第一段只读文件尾部（实测 4.7 MB 会话 11 ms，而全量要 1140 ms），把最近若干条
 * 历史先画出来；第二段再取完整历史替换它。抽成独立函数是为了能直接测顺序与
 * 跳过条件，而不是靠渲染整个会话管理器去间接观察。
 *
 * 与 ADR-0147 的关系：那条约束禁止「在已显示的行上方插入历史」。这里是把整个列表
 * 替换成同一份历史的超集，行的 id 都来自 `entryId`，底部对齐的滚动位置不会错位。
 */
export interface SessionPreviewStages {
	readonly readTail: () => Promise<{ history: HistoryEntry[]; truncated: boolean }>;
	readonly readFull: () => Promise<{ history: HistoryEntry[] }>;
	/** 尾部片段就绪（可能是空、也可能不完整）。 */
	readonly onTail: (history: HistoryEntry[]) => void | Promise<void>;
	/** 完整历史就绪。 */
	readonly onFull: (history: HistoryEntry[]) => void | Promise<void>;
	/** 每次提交前调用，返回 false 表示这次打开已被取代、不要再往下走。 */
	readonly isCurrent?: () => boolean;
}

export async function presentSessionPreview(stages: SessionPreviewStages): Promise<void> {
	const tail = await stages.readTail().catch(() => null);
	const stillCurrent = (): boolean => stages.isCurrent?.() ?? true;

	// 完整历史的读取在这里就发起，**不等片段提交完**。
	// 片段提交里通常含一次「等这一帧真的画出来」的屏障；那个屏障在窗口被遮挡或 rAF
	// 被节流时会一直等到超时（实测量到过 10 s），把它放在完整读取之前，等于让用户
	// 先看十秒半截内容、再等一两秒解析——正是「黑屏一会儿才出来」的形态。
	const fullPromise = stages.readFull();

	// 片段本身没有价值（读不到、或就是整份文件）时不做第二次渲染：
	// 否则会先画一遍、再画一遍同样的内容。
	if (tail?.truncated && tail.history.length > 0 && stillCurrent()) {
		await stages.onTail(tail.history);
	}

	const full = await fullPromise;
	if (!stillCurrent()) return;
	await stages.onFull(full.history);
}
