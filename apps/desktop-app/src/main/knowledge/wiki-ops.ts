/**
 * wiki 加工产物的破坏性维护：清空全部 wiki / 删除指定原始文件的 wiki 页。
 *
 * wiki/ 是全库共享的 LLM 加工产物，manifest/tags/indexes 是可由 frontmatter 重建的缓存。
 * 删 wiki 物理文件后重建缓存即可——对应原始文件保留，下一轮会被当作未加工重新整理。
 * 所有操作经 runKnowledgeMaintenance 持「加工轮」互斥锁，杜绝与后台加工轮竞态。
 */

import { mkdir, rm } from "node:fs/promises";
import * as knowledge from "@vetta/runtime-knowledge";
import { KB_PROCESSING_CWD, KB_PROCESSING_SESSION_DIR } from "../ipc/fs.js";
import { runKnowledgeMaintenance } from "./poller.js";

/**
 * 清空整个 wiki 目录并重建空缓存（manifest/tags/indexes），并清空加工记录
 * （processing_records 下的加工 session）。影响全部知识库。
 */
export function clearAllWiki(): Promise<void> {
	return runKnowledgeMaintenance(async (root) => {
		await rm(knowledge.wikiDir(root), { recursive: true, force: true });
		// 加工记录（每轮加工的 agent session jsonl）随 wiki 一并清空，下次加工重新生成。
		await rm(KB_PROCESSING_CWD, { recursive: true, force: true });
		await knowledge.ensureKnowledgeDirs(root); // 重建空 wiki/ 与 processing_records 目录
		await knowledge.rebuildAllCaches(root); // 空 manifest/tags/INDEX.md
	});
}

/**
 * 只清空加工记录（processing_records 下每轮加工的 agent session jsonl），保留 wiki 产物。
 * 走「加工轮」互斥锁：会中止在跑的轮并独占执行，避免删到正在写入的 session。
 */
export function clearProcessingRecords(): Promise<void> {
	return runKnowledgeMaintenance(async () => {
		await rm(KB_PROCESSING_SESSION_DIR, { recursive: true, force: true });
		await mkdir(KB_PROCESSING_SESSION_DIR, { recursive: true }); // 重建空 sessions 目录，下轮加工照常落盘
	});
}

/**
 * 删除指定原始文件（relPaths，相对 raws/<kbId>/）已加工出的 wiki 页并重建缓存。
 * relPath 可为目录：其下所有文件的 wiki 页一并删除。删后对应文件变为未加工，下一轮重整理。
 */
export function deleteWikiForEntries(kbId: string, relPaths: string[]): Promise<void> {
	return runKnowledgeMaintenance(async (root) => {
		const sources = relPaths.map((rel) => `${kbId}/${rel}`);
		const { pages } = await knowledge.scanWikiPages(root);
		const targets = pages.filter((p) => {
			const sp = p.frontmatter.source_path;
			return sources.some((s) => sp === s || sp.startsWith(`${s}/`));
		});
		if (targets.length === 0) return;
		for (const page of targets) await knowledge.deleteWikiPage(root, page.path);
		await knowledge.pruneEmptyWikiDirs(root);
		await knowledge.rebuildAllCaches(root);
	});
}
