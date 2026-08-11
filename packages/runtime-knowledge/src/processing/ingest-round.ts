/**
 * 摄入编排的工程侧操作（非 agent）。
 *
 * 一轮加工的工程侧职责：
 *   prepareRound  —— 算 diff；moved 纯元数据更新；本轮 deleted 标 orphaned_at；
 *                    返回 added/changed 给 agent，以及 toReap（上一轮孤儿）供 agent 复判。
 *   finalizeRound —— agent 复判/抢救完成后，物理删除仍为孤儿的上一轮孤儿；并重建缓存。
 *
 * 缓存（tags.json / manifest.json / indexes/INDEX.md）是 frontmatter 的派生产物，
 * 一轮只在 finalizeRound 收尾时重建一次（不在 prepareRound、也不在每次 kb_write_page）。
 * diff 基线直接据当前 wiki frontmatter 现算，不依赖 manifest.json——即便它损坏/过期，
 * 也不会把整库误判为新增而触发整库重加工。
 *
 * moved/markOrphans 只动 frontmatter（真相源），不重加工、不耗 token。
 */

import { rebuildManifest, rebuildTagsIndex, type WikiPageRef } from "../domain/derived-indexes.js";
import { buildIndexMap } from "../domain/index-map.js";
import {
	type AttemptedFile,
	applyQuarantine,
	quarantinedPaths,
	reconcileFailures,
} from "../domain/processing-failures.js";
import { diffRaws, planOrphans, type RawsDiff } from "../domain/raw-diff.js";
import type { ManifestEntry } from "../domain/types.js";
import {
	deleteWikiPage,
	pruneEmptyWikiDirs,
	readFailures,
	scanRaws,
	scanWikiPages,
	writeFailures,
	writeIndexMap,
	writeManifest,
	writeTagsIndex,
	writeWikiPage,
} from "../storage/file-knowledge-store.js";

/** rebuildAllCaches 结果：被 scanWikiPages 排除（frontmatter 非法/缺失）的坏页清单。 */
export interface RebuildResult {
	/** 解析失败、未进缓存的 wiki 页（相对 wiki/ 路径 + 原因）。空数组表示全部健康。 */
	damaged: Array<{ path: string; message: string }>;
}

/**
 * 据真相源（wiki frontmatter）重建 tags.json / manifest.json / indexes/INDEX.md。
 * 返回坏页清单供调用方上报——这些页不在缓存里，其源文件会一直显示未加工，须让用户可见。
 */
export async function rebuildAllCaches(root: string): Promise<RebuildResult> {
	const { pages, errors } = await scanWikiPages(root);
	const refs: WikiPageRef[] = pages.map((p) => ({ frontmatter: p.frontmatter, path: p.path }));
	await Promise.all([
		writeManifest(root, rebuildManifest(refs)),
		writeTagsIndex(root, rebuildTagsIndex(refs)),
		writeIndexMap(root, buildIndexMap(refs)),
	]);
	return { damaged: errors };
}

export interface PreparedRound {
	diff: RawsDiff;
	/** 上一轮（或更早）标记的孤儿，本轮交 agent 复判后回收。 */
	toReap: ManifestEntry[];
}

/**
 * 一轮加工的工程侧前置处理。
 * @param now 本轮开始时间（ISO）。
 */
export async function prepareRound(root: string, now: string): Promise<PreparedRound> {
	// diff 基线据当前 wiki frontmatter 现算（不读 manifest.json，避免缓存损坏导致误判）。
	const { pages } = await scanWikiPages(root);
	const refs: WikiPageRef[] = pages.map((p) => ({ frontmatter: p.frontmatter, path: p.path }));
	const manifest = rebuildManifest(refs);

	const raws = await scanRaws(root);
	const diff = diffRaws(manifest.pages, raws);
	const plan = planOrphans(manifest, diff, now);

	// 止损：剔除已隔离（连续失败达阈值）的 added/changed，不再自动重加工——
	// 否则永远写不出 wiki 页的硬骨头文件会每轮重入 added，无限加工。
	// 隔离按 source_path 记账，且仅当该路径内容（hash）未变时生效——内容一变即自动重试。
	const failures = await readFailures(root);
	const currentRaws = new Map(raws.map((r) => [r.source_path, r.source_hash]));
	const quarantined = quarantinedPaths(failures, currentRaws);

	const byId = new Map(pages.map((p) => [p.frontmatter.id, p]));

	// moved：纯元数据更新（source / source_path），内容与 hash 不变。
	for (const m of diff.moved) {
		const page = byId.get(m.id);
		if (!page) continue;
		page.frontmatter.source = m.source;
		page.frontmatter.source_path = m.to;
		page.frontmatter.updated_at = now;
		await writeWikiPage(root, page.path, page.frontmatter, page.body);
	}

	// 本轮新删除 → 标 orphaned_at。
	for (const d of plan.toMark) {
		const page = byId.get(d.id);
		if (!page) continue;
		page.frontmatter.orphaned_at = now;
		page.frontmatter.updated_at = now;
		await writeWikiPage(root, page.path, page.frontmatter, page.body);
	}

	return { diff: applyQuarantine(diff, quarantined), toReap: plan.toReap };
}

/**
 * 轮末据本轮结果对账失败记录（仅在加工轮正常完成、非中止时调用）。
 * 重新扫描 wiki，判定本轮尝试的每个文件是否真写出了页：写出→清除失败记录，
 * 仍无→失败次数 +1（达阈值则隔离）。被用户中止的轮次不计失败，避免误隔离。
 * @param attempted 本轮实际尝试加工的文件（取自过滤掉隔离项后的 diff）。
 */
export async function reconcileRoundFailures(root: string, attempted: AttemptedFile[], now: string): Promise<void> {
	if (attempted.length === 0) return;
	const [{ pages }, raws, failures] = await Promise.all([scanWikiPages(root), scanRaws(root), readFailures(root)]);
	// 活跃页按 source_path 索引到其 source_hash：判定某路径是否真写出了页且内容一致。
	const presentByPath = new Map(
		pages
			.filter((p) => p.frontmatter.orphaned_at == null)
			.map((p) => [p.frontmatter.source_path, p.frontmatter.source_hash]),
	);
	const currentRaws = new Map(raws.map((r) => [r.source_path, r.source_hash]));
	const next = reconcileFailures({ failures, attempted, presentByPath, currentRaws, now });
	await writeFailures(root, next);
}

/**
 * 一轮加工的工程侧收尾：物理删除仍为孤儿的上一轮孤儿、清理 wiki 空目录，并重建缓存。
 * 删除与空目录清理均为确定性工程动作（不经 agent）。重建无条件执行——它是本轮唯一一次
 * 缓存重建（kb_write_page 与 prepareRound 都不再重建），无孤儿可回收时也要刷新缓存。
 */
export async function finalizeRound(root: string, toReap: ManifestEntry[]): Promise<void> {
	if (toReap.length > 0) {
		const { pages } = await scanWikiPages(root);
		const stillOrphan = new Map(
			pages.filter((p) => p.frontmatter.orphaned_at != null).map((p) => [p.frontmatter.id, p.path]),
		);
		let deleted = 0;
		for (const entry of toReap) {
			const path = stillOrphan.get(entry.id);
			if (path) {
				await deleteWikiPage(root, path);
				deleted += 1;
			}
		}
		// 删页可能留下空主题目录，自底向上清理（不删 wiki 根）。
		if (deleted > 0) await pruneEmptyWikiDirs(root);
	}
	await rebuildAllCaches(root);
}
