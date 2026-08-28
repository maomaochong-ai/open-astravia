/**
 * 构造一轮加工的 agent 任务 prompt。
 *
 * 工程侧已处理 moved（纯元数据）、孤儿标记与孤儿物理删除（不经 agent）；交给 agent 的只有：
 *   - added：读原始文件，新建 wiki 页（kb_write_page，不传 id）
 *   - changed：读原始文件，按 id 就地更新（kb_write_page 传 id）
 */

import { join } from "node:path";
import type { RawsDiff } from "../domain/raw-diff.js";
import { rawsDir } from "../storage/file-knowledge-store.js";

const formatRaws = (label: string, items: string[]): string =>
	items.length === 0 ? "" : `\n## ${label}\n${items.map((s) => `- ${s}`).join("\n")}`;

/**
 * 渲染本轮任务 prompt。给出每个文件的绝对路径，避免 agent 因 cwd 非知识库根而拼错相对路径。
 * @param root 知识库根目录（默认 ~/.vetta/knowledges）。
 */
export function buildProcessingPrompt(diff: RawsDiff, root: string, tmpDir?: string): string {
	const rawsBase = rawsDir(root);
	const added = diff.added.map(
		(a) =>
			`${join(rawsBase, a.raw.source_path)}（source=${a.raw.source}，source_path=${a.raw.source_path}，source_hash=${a.raw.source_hash}）→ 读它 → kb_write_page 新建`,
	);
	const changed = diff.changed.map(
		(c) =>
			`${join(rawsBase, c.source_path)}（source=${c.source}，source_path=${c.source_path}，新 source_hash=${c.newHash}）→ 读它 → kb_write_page 传 id="${c.id}" 就地更新`,
	);

	const sections = [
		formatRaws("新增文件（读原文 → kb_write_page 新建）", added),
		formatRaws("内容变更文件（读原文 → kb_write_page 按 id 更新）", changed),
	]
		.filter(Boolean)
		.join("\n");

	const tmpNote = tmpDir ? `\n\n临时工作目录（所有中间/临时文件写这里，勿污染 raws/）：${tmpDir}` : "";
	return `# 本轮知识库加工任务\n${sections}${tmpNote}\n\n组织好 wiki 树与各页 title/summary 即可；indexes/INDEX.md 目录会自动重建，无需手动维护。`;
}
