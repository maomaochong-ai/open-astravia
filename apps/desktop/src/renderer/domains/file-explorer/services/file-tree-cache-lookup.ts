import { pathDirname } from "@shared/lib/utils";
import type { FsEntry } from "@shared/store/atoms";

/**
 * 按路径在文件树缓存里找条目。
 *
 * 以前是把缓存里所有目录的条目摊平再按 path 建索引：目录展开得越多，
 * 这个映射就越大，而它挂在 `useMemo`/reveal 上，缓存一变、选区一变都要重建一遍。
 * 逐条只查它自己的父目录，代价只跟单个目录的条目数有关。
 */
export function findCachedEntries(cache: ReadonlyMap<string, readonly FsEntry[]>, paths: readonly string[]): FsEntry[] {
	const found: FsEntry[] = [];
	for (const path of paths) {
		const sibling = cache.get(pathDirname(path))?.find((entry) => entry.path === path);
		if (sibling) found.push(sibling);
	}
	return found;
}

/** 同 {@link findCachedEntries}，但只取第一条命中。 */
export function findCachedEntry(cache: ReadonlyMap<string, readonly FsEntry[]>, path: string): FsEntry | undefined {
	return cache.get(pathDirname(path))?.find((entry) => entry.path === path);
}
