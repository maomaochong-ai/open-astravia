import { createFileExplorerVisibility, type FileExplorerPreferences } from "@shared/lib/file-explorer-preferences";
import type { FsEntry } from "@shared/store/atoms";

interface DirectoryFilterCache {
	source: readonly FsEntry[];
	filtered: FsEntry[];
}

export interface FileTreeVisibleCache {
	compute(
		rootCwd: string,
		cache: ReadonlyMap<string, FsEntry[]>,
		preferences: FileExplorerPreferences,
	): Map<string, FsEntry[]>;
}

/**
 * 文件树的可见性过滤按目录增量计算。
 *
 * `cache` 每加载一层目录就会变化一次，全量重算会让成本随已展开层数线性叠加：
 * 展开十层就是几十万次 path 归一化与 glob 匹配，全部发生在一次渲染的 useMemo 里。
 * 这里只重算新增或被替换的目录，其余目录直接复用上一次的过滤结果。
 */
export function createFileTreeVisibleCache(): FileTreeVisibleCache {
	let root: string | null = null;
	let preferences: FileExplorerPreferences | null = null;
	let visible: ((path: string) => boolean) | null = null;
	let directories = new Map<string, DirectoryFilterCache>();

	return {
		compute(nextRoot, cache, nextPreferences) {
			if (root !== nextRoot || preferences !== nextPreferences) {
				root = nextRoot;
				preferences = nextPreferences;
				visible = createFileExplorerVisibility(nextRoot, nextPreferences);
				directories = new Map();
			}
			const isVisible = visible;
			if (!isVisible) return new Map();

			const result = new Map<string, FsEntry[]>();
			for (const [directory, entries] of cache) {
				// 根目录自身永远可见，隐藏判定只约束它的子项。
				if (directory !== nextRoot && !isVisible(directory)) continue;
				const cached = directories.get(directory);
				if (cached && cached.source === entries) {
					result.set(directory, cached.filtered);
					continue;
				}
				const filtered = entries.filter((entry) => isVisible(entry.path));
				directories.set(directory, { source: entries, filtered });
				result.set(directory, filtered);
			}
			// 目录被移出缓存（删除、切换根目录）后不保留过滤结果。
			for (const directory of directories.keys()) {
				if (!result.has(directory)) directories.delete(directory);
			}
			return result;
		},
	};
}
