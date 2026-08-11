/**
 * index-map：从 wiki frontmatter（唯一真相源）生成 indexes/INDEX.md —— 镜像 wiki 树形的
 * 渐进式披露目录。每个叶子带 title + summary + [[id]]，供 agent 从入口逐层下探。
 *
 * 与 tags.json / manifest.json 同性质：可从 frontmatter 确定性重建的缓存，排除孤儿页。
 * agent 不再手写 indexes/，只需组织好 wiki 树与 title/summary，目录每轮自动重建。
 */

import type { WikiPageRef } from "./derived-indexes.js";

interface Leaf {
	title: string;
	summary: string;
	id: string;
}

interface TreeNode {
	folders: Map<string, TreeNode>;
	pages: Leaf[];
}

const newNode = (): TreeNode => ({ folders: new Map(), pages: [] });

const HEADER = "# 知识库目录\n\n> 自动生成（镜像 wiki 树 + frontmatter）。请勿手改：每轮加工后据 frontmatter 重建。\n";

function renderNode(node: TreeNode, depth: number, lines: string[]): void {
	const indent = "  ".repeat(depth);
	for (const name of [...node.folders.keys()].sort((a, b) => a.localeCompare(b))) {
		lines.push(`${indent}- **${name}/**`);
		renderNode(node.folders.get(name) as TreeNode, depth + 1, lines);
	}
	for (const leaf of [...node.pages].sort((a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id))) {
		const summary = leaf.summary.trim();
		const tail = summary ? ` — ${summary} \`[[${leaf.id}]]\`` : ` \`[[${leaf.id}]]\``;
		lines.push(`${indent}- **${leaf.title}**${tail}`);
	}
}

/**
 * 生成知识库目录 markdown（镜像 wiki 树）。排除孤儿页。
 * @param pages wiki 页引用（frontmatter + 相对 wiki/ 的 posix 路径）。
 */
export function buildIndexMap(pages: WikiPageRef[]): string {
	const root = newNode();
	for (const { frontmatter, path } of pages) {
		if (frontmatter.orphaned_at != null) continue;
		const segments = path.split("/");
		let node = root;
		for (const folder of segments.slice(0, -1)) {
			let child = node.folders.get(folder);
			if (!child) {
				child = newNode();
				node.folders.set(folder, child);
			}
			node = child;
		}
		node.pages.push({ title: frontmatter.title, summary: frontmatter.summary, id: frontmatter.id });
	}

	const lines: string[] = [];
	renderNode(root, 0, lines);
	const body = lines.length > 0 ? lines.join("\n") : "_（暂无页面）_";
	return `${HEADER}\n${body}\n`;
}
