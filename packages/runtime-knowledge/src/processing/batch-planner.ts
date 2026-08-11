/**
 * 加工批次规划：把一轮的 added/changed 切成多个子 RawsDiff，每个交给一个独立 agent 会话。
 *
 * 目的纯粹是上下文边界——单会话塞不下 500 个文件，故按预算切成 ~每批 N 个。切批是确定性
 * 工程动作，不是 LLM 决策；抽取工具的选择仍由 agent 自主。续跑无需持久化游标：本批写出的
 * 页下一轮重算 diff 时自动从 added/changed 消失，没写的自动还在（hash-diff 自愈）。
 *
 * 装箱：按 source_path 排序让同目录文件相邻，贪心累积到「文件数」或「字节数」任一预算封顶；
 * 单个超预算的大文件独占一批（至少装 1 个）。moved/deleted 不进批（纯工程动作，buildProcessingPrompt
 * 也不读它们）。added 的字节大小来自 RawFile.size；changed 无 size 字段，stat 原始文件估算，
 * 失败则记 0（退化为按条数均分）。
 */

import { stat } from "node:fs/promises";
import { join } from "node:path";
import type { AddedChange, ChangedChange, RawsDiff } from "../domain/raw-diff.js";
import { rawsDir } from "../storage/file-knowledge-store.js";

export interface BatchPlanOptions {
	/** 每批最多文件数。 */
	maxFilesPerBatch: number;
	/** 每批最多字节数（估算）。 */
	maxBytesPerBatch: number;
}

interface WorkItem {
	sortKey: string;
	size: number;
	added?: AddedChange;
	changed?: ChangedChange;
}

/**
 * 切批。返回若干子 RawsDiff（每个 moved/deleted 为空）；无 added/changed 时返回空数组。
 * @param root 知识库根目录（stat changed 文件用）。
 */
export async function planProcessingBatches(
	diff: RawsDiff,
	root: string,
	options: BatchPlanOptions,
): Promise<RawsDiff[]> {
	const rawsBase = rawsDir(root);

	const changedSizes = await Promise.all(
		diff.changed.map(async (c) => {
			try {
				return (await stat(join(rawsBase, c.source_path))).size;
			} catch {
				return 0;
			}
		}),
	);

	const items: WorkItem[] = [
		...diff.added.map((a) => ({ sortKey: a.raw.source_path, size: a.raw.size, added: a })),
		...diff.changed.map((c, i) => ({ sortKey: c.source_path, size: changedSizes[i] ?? 0, changed: c })),
	];
	items.sort((a, b) => a.sortKey.localeCompare(b.sortKey));

	const maxFiles = Math.max(1, Math.floor(options.maxFilesPerBatch));
	const maxBytes = Math.max(1, Math.floor(options.maxBytesPerBatch));

	const batches: RawsDiff[] = [];
	let cur: RawsDiff | null = null;
	let curFiles = 0;
	let curBytes = 0;

	const startBatch = (): RawsDiff => {
		const b: RawsDiff = { added: [], moved: [], changed: [], deleted: [] };
		batches.push(b);
		curFiles = 0;
		curBytes = 0;
		return b;
	};

	for (const item of items) {
		// 当前批非空，且再加这个会超任一预算 → 封批另起。单文件超预算时独占一批（cur 为空时不封）。
		if (cur && curFiles >= 1 && (curFiles + 1 > maxFiles || curBytes + item.size > maxBytes)) {
			cur = null;
		}
		if (!cur) cur = startBatch();
		if (item.added) cur.added.push(item.added);
		if (item.changed) cur.changed.push(item.changed);
		curFiles += 1;
		curBytes += item.size;
	}

	return batches;
}
