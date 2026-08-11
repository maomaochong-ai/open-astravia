/**
 * 加工失败计数与隔离（纯逻辑，不做 IO）。
 *
 * 背景：「wiki 页存在且 hash 匹配」是某原始文件「加工成功」的唯一凭证。任何永远写不出
 * wiki 页的文件（OCR 失败/超大/agent 中途崩/被中止/上下文溢出），都查不到对应 wiki 页，
 * 于是每一轮都重新落入 added/changed → 无限重加工。
 *
 * 本模块给「永久失败的文件」加止损：按 source_path 记录连续失败次数，达到阈值即隔离
 * （quarantined），后续轮次不再自动重加工。文件内容变化（hash 变）视为重新可加工，自动
 * 重试；用户也可手动清除隔离重试（见 clearFailures）。
 *
 * 以 source_path 为键（而非 source_hash）：同一份内容可能被用户拷贝到多个不同路径，
 * 它们各自是独立的页（身份为 source_hash+source_path）。若按 hash 记账，一个副本写出页
 * 会误清掉另一个副本的失败记录，导致永远写不出页的副本逃过隔离、无限重加工。entry 里
 * 另存 source_hash，用于判定「内容是否变化 → 自动重试」（隔离只在内容未变时生效）。
 */

import type { RawsDiff } from "./raw-diff.js";

/** 连续失败达到该次数即隔离，不再自动重加工。 */
export const KB_MAX_PROCESSING_ATTEMPTS = 3;

export interface FailureEntry {
	/** 该文件最近一次尝试加工时的内容 hash（用于判定内容是否变化 → 自动重试）。 */
	source_hash: string;
	/** 原始文件相对路径（同时是本记录的键）。 */
	source_path: string;
	/** 连续失败次数。 */
	attempts: number;
	/** 首次失败时间（ISO）。 */
	first_failed_at: string;
	/** 最近一次失败时间（ISO）。 */
	last_failed_at: string;
	/** 是否已隔离（attempts 达阈值）。隔离后内容未变则不再自动重加工。 */
	quarantined: boolean;
}

/** failures.json：source_path → 失败记录。 */
export interface FailuresRecord {
	version: 1;
	entries: Record<string, FailureEntry>;
}

export const EMPTY_FAILURES: FailuresRecord = { version: 1, entries: {} };

/** 本轮实际尝试加工的文件（来自过滤掉隔离项后的 diff）。 */
export interface AttemptedFile {
	source_hash: string;
	source_path: string;
}

/** 从 diff 抽出本轮尝试加工的文件（added 用 raw.hash，changed 用 newHash）。 */
export function attemptedFiles(diff: RawsDiff): AttemptedFile[] {
	return [
		...diff.added.map((a) => ({ source_hash: a.raw.source_hash, source_path: a.raw.source_path })),
		...diff.changed.map((c) => ({ source_hash: c.newHash, source_path: c.source_path })),
	];
}

/**
 * 当前仍生效的隔离 source_path 集合：记录已隔离，且该路径当前内容（hash）与隔离时一致。
 * 内容已变（hash 不同）或路径已删的隔离不再生效——视为可重试。
 * @param currentRaws 当前 raws：source_path → source_hash。
 */
export function quarantinedPaths(failures: FailuresRecord, currentRaws: Map<string, string>): Set<string> {
	const set = new Set<string>();
	for (const [path, entry] of Object.entries(failures.entries)) {
		if (entry.quarantined && currentRaws.get(path) === entry.source_hash) set.add(path);
	}
	return set;
}

/**
 * 从 diff 里剔除已隔离的 added/changed（按 source_path，不再自动重加工）。
 * moved（纯元数据）、deleted（标孤儿）不受影响，始终照常处理。
 */
export function applyQuarantine(diff: RawsDiff, quarantined: Set<string>): RawsDiff {
	if (quarantined.size === 0) return diff;
	return {
		added: diff.added.filter((a) => !quarantined.has(a.raw.source_path)),
		changed: diff.changed.filter((c) => !quarantined.has(c.source_path)),
		moved: diff.moved,
		deleted: diff.deleted,
	};
}

export interface ReconcileInput {
	/** 轮前的失败记录。 */
	failures: FailuresRecord;
	/** 本轮尝试加工的文件。 */
	attempted: AttemptedFile[];
	/** 轮后活跃 wiki 页：source_path → source_hash（判定该路径是否真写出了页且内容一致）。 */
	presentByPath: Map<string, string>;
	/** 当前 raws：source_path → source_hash（剪枝：路径已删/内容已变的旧记录直接丢弃）。 */
	currentRaws: Map<string, string>;
	/** 本轮时间（ISO）。 */
	now: string;
	threshold?: number;
}

/**
 * 据本轮结果对账失败记录（纯函数，返回新记录）：
 * - 尝试过且该路径已有活跃页、且 hash 与本轮尝试内容一致 → 成功 → 清除记录
 * - 尝试过但该路径仍无匹配页 → 失败 → 次数 +1，达阈值则隔离
 * - 记录里的路径已不在当前 raws，或该路径内容已变（hash 不同）→ 剪枝丢弃（视为新文件）
 */
export function reconcileFailures(input: ReconcileInput): FailuresRecord {
	const { failures, attempted, presentByPath, currentRaws, now, threshold = KB_MAX_PROCESSING_ATTEMPTS } = input;
	const entries: Record<string, FailureEntry> = { ...failures.entries };

	for (const file of attempted) {
		if (presentByPath.get(file.source_path) === file.source_hash) {
			delete entries[file.source_path];
			continue;
		}
		const prev = entries[file.source_path];
		const attempts = (prev?.attempts ?? 0) + 1;
		entries[file.source_path] = {
			source_hash: file.source_hash,
			source_path: file.source_path,
			attempts,
			first_failed_at: prev?.first_failed_at ?? now,
			last_failed_at: now,
			quarantined: attempts >= threshold,
		};
	}

	for (const [path, entry] of Object.entries(entries)) {
		const cur = currentRaws.get(path);
		if (cur === undefined || cur !== entry.source_hash) delete entries[path];
	}

	return { version: 1, entries };
}

/**
 * 清除指定 source_path 的隔离/失败记录（手动重试）。传空集则清除全部。
 * 返回新记录。
 */
export function clearFailures(failures: FailuresRecord, paths?: Set<string>): FailuresRecord {
	if (!paths) return { version: 1, entries: {} };
	const entries: Record<string, FailureEntry> = { ...failures.entries };
	for (const path of paths) delete entries[path];
	return { version: 1, entries };
}
