/**
 * 原始文件与知识页真相源之间的确定性差异计算。
 *
 * 输入上一轮 manifest（每页带 source_path + source_hash + id）与当前 raws 扫描，
 * 输出分类 diff。判定顺序（关键）：
 *   1. exact —— 同 path 同 hash：未变，跳过
 *   2. moved —— 同 hash 换 path：内容没变，纯元数据更新，不重加工
 *   3. changed —— 同 path 换 hash：内容变了，按旧 id 就地更新
 *   4. added —— 剩余 current：新建页
 *   5. deleted —— 剩余 live prior：原始文件没了，标记孤儿
 *
 * 孤儿 n+1 回收：已是孤儿的 manifest 页不参与匹配（不会再被当 deleted），
 * 由 planOrphans 决定哪些在本轮被回收（上一轮标记的）、哪些是本轮新孤儿。
 */

import type { Manifest, ManifestEntry, RawFile } from "./types.js";

export interface AddedChange {
	type: "added";
	raw: RawFile;
}

export interface MovedChange {
	type: "moved";
	id: string;
	from: string;
	to: string;
	source: string;
	source_hash: string;
}

export interface ChangedChange {
	type: "changed";
	id: string;
	source_path: string;
	oldHash: string;
	newHash: string;
	source: string;
}

export interface DeletedChange {
	type: "deleted";
	id: string;
	source_path: string;
	source_hash: string;
}

export interface RawsDiff {
	added: AddedChange[];
	moved: MovedChange[];
	changed: ChangedChange[];
	deleted: DeletedChange[];
}

/** diff 是否完全为空（无任何变更）。 */
export function isEmptyDiff(diff: RawsDiff): boolean {
	return diff.added.length === 0 && diff.moved.length === 0 && diff.changed.length === 0 && diff.deleted.length === 0;
}

/**
 * 本轮是否需要起 LLM 加工会话。
 * 只有 added/changed 需要读原文 → 写 wiki 页（LLM）。
 * moved（纯元数据）、deleted（标孤儿）、孤儿回收均为工程侧动作，不需要 LLM。
 */
export function diffNeedsProcessing(diff: RawsDiff): boolean {
	return diff.added.length > 0 || diff.changed.length > 0;
}

/**
 * 计算 raws 变更 diff。
 * @param prior 上一轮 manifest 的全部页（含孤儿；孤儿会被自动排除出匹配集）。
 * @param current 当前 raws 扫描结果。
 */
export function diffRaws(prior: ManifestEntry[], current: RawFile[]): RawsDiff {
	// 只有非孤儿页代表"当前应存在的原始文件"，参与匹配。
	const livePrior = prior.filter((p) => p.orphaned_at == null);

	const remainingPrior = new Map<string, ManifestEntry>();
	for (const p of livePrior) {
		remainingPrior.set(p.id, p);
	}
	const matchedCurrent = new Set<number>();

	const diff: RawsDiff = { added: [], moved: [], changed: [], deleted: [] };

	const findPrior = (predicate: (p: ManifestEntry) => boolean): ManifestEntry | undefined => {
		for (const p of remainingPrior.values()) {
			if (predicate(p)) return p;
		}
		return undefined;
	};

	// Pass 1: exact（同 path 同 hash）→ 未变
	current.forEach((c, i) => {
		const p = findPrior((p) => p.source_path === c.source_path && p.source_hash === c.source_hash);
		if (p) {
			remainingPrior.delete(p.id);
			matchedCurrent.add(i);
		}
	});

	// Pass 2: moved（同 hash 换 path）
	current.forEach((c, i) => {
		if (matchedCurrent.has(i)) return;
		const p = findPrior((p) => p.source_hash === c.source_hash);
		if (p) {
			remainingPrior.delete(p.id);
			matchedCurrent.add(i);
			diff.moved.push({
				type: "moved",
				id: p.id,
				from: p.source_path,
				to: c.source_path,
				source: c.source,
				source_hash: c.source_hash,
			});
		}
	});

	// Pass 3: changed（同 path 换 hash）
	current.forEach((c, i) => {
		if (matchedCurrent.has(i)) return;
		const p = findPrior((p) => p.source_path === c.source_path);
		if (p) {
			remainingPrior.delete(p.id);
			matchedCurrent.add(i);
			diff.changed.push({
				type: "changed",
				id: p.id,
				source_path: c.source_path,
				oldHash: p.source_hash,
				newHash: c.source_hash,
				source: c.source,
			});
		}
	});

	// Pass 4: 剩余 current → added
	current.forEach((c, i) => {
		if (matchedCurrent.has(i)) return;
		diff.added.push({ type: "added", raw: c });
	});

	// Pass 5: 剩余 livePrior → deleted（标孤儿）
	for (const p of remainingPrior.values()) {
		diff.deleted.push({
			type: "deleted",
			id: p.id,
			source_path: p.source_path,
			source_hash: p.source_hash,
		});
	}

	return diff;
}

export interface OrphanPlan {
	/** 已在此轮之前被标记的孤儿 → 本轮（agent 复判后）物理删除。 */
	toReap: ManifestEntry[];
	/** 本轮新检测到的删除 → 设置 orphaned_at。 */
	toMark: DeletedChange[];
}

/**
 * n+1 孤儿回收规划。
 * @param manifest 当前 manifest。
 * @param diff 本轮 diff（deleted 即本轮新孤儿）。
 * @param roundStartedAt 本轮开始时间（ISO）；孤儿 orphaned_at < 该时间者视为"上一轮或更早"的孤儿，本轮回收。
 */
export function planOrphans(manifest: Manifest, diff: RawsDiff, roundStartedAt: string): OrphanPlan {
	const toReap = manifest.pages.filter((p) => p.orphaned_at != null && p.orphaned_at < roundStartedAt);
	return { toReap, toMark: diff.deleted };
}
