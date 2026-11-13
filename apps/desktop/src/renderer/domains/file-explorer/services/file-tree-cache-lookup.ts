import { pathDirname } from "@shared/lib/utils";
import type { FsEntry } from "@shared/store/atoms";

/**
 * 按路径在文件树缓存里找条目。
 *
 * 以前是把缓存里所有目录的条目摊平再按 path 建索引：目录展开得越多，
 * 这个映射就越大，而它挂在 `useMemo`/reveal 上，缓存一变、选区一变都要重建一遍。
 * 逐条只查它自己的父目录，代价只跟单个目录的条目数有关。
 *
 * 分隔符必须容错：缓存键来自主进程的 `readDir`，在 Windows 上是反斜杠；
 * 而对话里的交付物链接、插件传进来的路径多半是正斜杠。直接按原串查表会静默落空，
 * 表现就是「点了文件名，文件树没反应」——Windows 上尤其明显。
 */
function normalizePathKey(path: string): string {
	return path.replace(/\\/g, "/");
}

/** 缓存里同一个目录可能只存了另一种分隔符，两种形式都试一次。 */
function lookupDirectory(
	cache: ReadonlyMap<string, readonly FsEntry[]>,
	directory: string,
): readonly FsEntry[] | undefined {
	const direct = cache.get(directory);
	if (direct) return direct;
	const alternates = directory.includes("\\") ? [directory.replace(/\\/g, "/")] : [directory.replace(/\//g, "\\")];
	for (const alternate of alternates) {
		const found = cache.get(alternate);
		if (found) return found;
	}
	// 兜底：逐目录按规范化后的键比对（目录数很少，且只在直接命中失败时走到这里）。
	const target = normalizePathKey(directory);
	for (const [key, entries] of cache) {
		if (normalizePathKey(key) === target) return entries;
	}
	return undefined;
}

function findInDirectory(entries: readonly FsEntry[] | undefined, path: string): FsEntry | undefined {
	if (!entries) return undefined;
	const exact = entries.find((entry) => entry.path === path);
	if (exact) return exact;
	const target = normalizePathKey(path);
	return entries.find((entry) => normalizePathKey(entry.path) === target);
}

export function findCachedEntries(cache: ReadonlyMap<string, readonly FsEntry[]>, paths: readonly string[]): FsEntry[] {
	const found: FsEntry[] = [];
	for (const path of paths) {
		const sibling = findInDirectory(lookupDirectory(cache, pathDirname(path)), path);
		if (sibling) found.push(sibling);
	}
	return found;
}

/** 同 {@link findCachedEntries}，但只取第一条命中。 */
export function findCachedEntry(cache: ReadonlyMap<string, readonly FsEntry[]>, path: string): FsEntry | undefined {
	return findInDirectory(lookupDirectory(cache, pathDirname(path)), path);
}
