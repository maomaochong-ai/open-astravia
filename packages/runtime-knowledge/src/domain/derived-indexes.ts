/**
 * 从 wiki frontmatter 真相源重建 tags.json 与 manifest.json。
 *
 * manifest 含全部页（含孤儿，需追踪 orphaned_at 以做 n+1 回收）。
 * tags 索引排除孤儿页（孤儿待删除，不应出现在检索结果里）。
 */

import type { Manifest, ManifestEntry, TagsIndex, WikiFrontmatter } from "./types.js";

export interface WikiPageRef {
	frontmatter: WikiFrontmatter;
	/** wiki 页相对 wiki/ 的路径。 */
	path: string;
}

function toManifestEntry(page: WikiPageRef): ManifestEntry {
	return {
		id: page.frontmatter.id,
		path: page.path,
		source_path: page.frontmatter.source_path,
		source_hash: page.frontmatter.source_hash,
		orphaned_at: page.frontmatter.orphaned_at,
	};
}

/** 重建 manifest.json，页按 id 排序保证确定性。 */
export function rebuildManifest(pages: WikiPageRef[]): Manifest {
	const entries = pages.map(toManifestEntry).sort((a, b) => a.id.localeCompare(b.id));
	return { version: 1, pages: entries };
}

/** 重建 tags.json：tag → 排序去重的 id 列表，排除孤儿页。 */
export function rebuildTagsIndex(pages: WikiPageRef[]): TagsIndex {
	const tagToIds = new Map<string, Set<string>>();
	for (const { frontmatter } of pages) {
		if (frontmatter.orphaned_at != null) continue;
		for (const tag of frontmatter.tags) {
			let set = tagToIds.get(tag);
			if (!set) {
				set = new Set<string>();
				tagToIds.set(tag, set);
			}
			set.add(frontmatter.id);
		}
	}
	const tags: Record<string, string[]> = {};
	for (const tag of [...tagToIds.keys()].sort()) {
		tags[tag] = [...(tagToIds.get(tag) as Set<string>)].sort();
	}
	return { version: 1, tags };
}
