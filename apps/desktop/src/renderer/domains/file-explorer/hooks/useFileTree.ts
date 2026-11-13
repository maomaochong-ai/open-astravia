import { createFileExplorerVisibility } from "@shared/lib/file-explorer-preferences";
import { alignPathSeparators, isSubPath, pathBasename, pathDirname, pathJoin } from "@shared/lib/utils";
import {
	activeSessionAtom,
	expandedDirsAtom,
	type FsEntry,
	fileExplorerPreferencesAtom,
	fileTreeCacheAtom,
	loadingDirsAtom,
} from "@shared/store/atoms";
import { useAtom, useAtomValue } from "jotai";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { emitPluginFileExplorerFilesChanged } from "../../plugins/runtime/plugin-file-explorer-host";
import { createFileTreeVisibleCache, type FileTreeVisibleCache } from "./file-tree-visible-cache";
import { createDirectoryReloadScheduler, watchPathKey } from "./file-tree-watch-coalesce";

/**
 * @param cwdOverride 显式指定的根目录。不传则回退到当前活动 session 的 cwd，
 *                    用于"项目详情页"等没有 active session 的场景。
 */
export function useFileTree(cwdOverride?: string | null) {
	const [cache, setCache] = useAtom(fileTreeCacheAtom);
	const [expandedDirs, setExpandedDirs] = useAtom(expandedDirsAtom);
	const [loadingDirs, setLoadingDirs] = useAtom(loadingDirsAtom);
	const activeSession = useAtomValue(activeSessionAtom);
	const rootCwd = cwdOverride ?? activeSession?.cwd ?? null;
	const prevCwdRef = useRef<string | null>(null);
	const preferences = useAtomValue(fileExplorerPreferencesAtom);
	const visibleCacheFactoryRef = useRef<FileTreeVisibleCache | null>(null);
	const visibleCache = useMemo(() => {
		if (!rootCwd) return cache;
		visibleCacheFactoryRef.current ??= createFileTreeVisibleCache();
		return visibleCacheFactoryRef.current.compute(rootCwd, cache, preferences);
	}, [cache, rootCwd, preferences]);

	const loadDir = useCallback(
		async (dirPath: string) => {
			setLoadingDirs((prev) => new Set([...prev, dirPath]));
			try {
				const entries = await window.astravia.fs.readDir(dirPath);
				setCache((prev) => new Map([...prev, [dirPath, entries as FsEntry[]]]));
			} catch (err) {
				console.error("Failed to load directory:", dirPath, err);
			} finally {
				setLoadingDirs((prev) => {
					const next = new Set(prev);
					next.delete(dirPath);
					return next;
				});
			}
		},
		[setCache, setLoadingDirs],
	);

	const toggleDir = useCallback(
		(dirPath: string) => {
			setExpandedDirs((prev) => {
				const next = new Set(prev);
				if (next.has(dirPath)) {
					next.delete(dirPath);
				} else {
					next.add(dirPath);
					if (!cache.has(dirPath)) {
						void loadDir(dirPath);
					}
				}
				return next;
			});
		},
		[setExpandedDirs, cache, loadDir],
	);

	const expandDir = useCallback(
		async (dirPath: string) => {
			setExpandedDirs((prev) => new Set([...prev, dirPath]));
			if (!cache.has(dirPath)) await loadDir(dirPath);
		},
		[cache, loadDir, setExpandedDirs],
	);

	const collapseAll = useCallback(() => {
		setExpandedDirs(new Set());
	}, [setExpandedDirs]);

	const renameEntry = useCallback(
		async (oldPath: string, newName: string) => {
			const newPath = pathJoin(pathDirname(oldPath), newName);
			await window.astravia.fs.rename(oldPath, newPath);
			emitPluginFileExplorerFilesChanged([{ type: "moved", oldPath, path: newPath }]);
			// Refresh parent directory
			const parentDir = pathDirname(oldPath);
			await loadDir(parentDir);
		},
		[loadDir],
	);

	const deleteEntry = useCallback(
		async (entryPath: string) => {
			await window.astravia.fs.delete(entryPath);
			emitPluginFileExplorerFilesChanged([{ type: "deleted", path: entryPath }]);
			const parentDir = pathDirname(entryPath);
			// Remove from cache
			setCache((prev) => {
				const next = new Map(prev);
				const parentEntries = next.get(parentDir);
				if (parentEntries) {
					next.set(
						parentDir,
						parentEntries.filter((e) => e.path !== entryPath),
					);
				}
				// Also remove cached children if it was a directory
				for (const key of next.keys()) {
					if (isSubPath(key, entryPath)) {
						next.delete(key);
					}
				}
				return next;
			});
			// Remove from expanded
			setExpandedDirs((prev) => {
				const next = new Set(prev);
				for (const key of next) {
					if (isSubPath(key, entryPath)) {
						next.delete(key);
					}
				}
				return next;
			});
		},
		[setCache, setExpandedDirs],
	);

	const moveEntry = useCallback(
		async (srcPath: string, destDir: string) => {
			const name = pathBasename(srcPath);
			const srcParent = pathDirname(srcPath);
			if (srcParent === destDir) return;

			// Optimistic update
			setCache((prev) => {
				const next = new Map(prev);
				const srcEntries = next.get(srcParent);
				const movedEntry = srcEntries?.find((e) => e.path === srcPath);
				if (srcEntries) {
					next.set(
						srcParent,
						srcEntries.filter((e) => e.path !== srcPath),
					);
				}
				if (movedEntry) {
					const destEntries = next.get(destDir) ?? [];
					const updated: FsEntry = { ...movedEntry, path: pathJoin(destDir, name) };
					next.set(
						destDir,
						[...destEntries, updated].sort((a, b) => {
							if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
							return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
						}),
					);
				}
				return next;
			});

			try {
				await window.astravia.fs.move(srcPath, destDir);
				emitPluginFileExplorerFilesChanged([{ type: "moved", oldPath: srcPath, path: pathJoin(destDir, name) }]);
			} catch (err) {
				console.error("Move failed, refreshing:", err);
				// Rollback by reloading both directories
				await Promise.all([loadDir(srcParent), loadDir(destDir)]);
			}
		},
		[setCache, loadDir],
	);

	const refreshDir = useCallback(
		async (dirPath: string) => {
			await loadDir(dirPath);
		},
		[loadDir],
	);

	const revealPath = useCallback(
		async (entryPath: string) => {
			if (!rootCwd || !isSubPath(entryPath, rootCwd)) {
				throw new Error(`Path is outside the active workspace: ${entryPath}`);
			}
			// 先把分隔符对齐到根目录的写法：缓存键与 expandedDirs 都来自主进程原始返回值，
			// 正斜杠的路径直接进去会既不展开也选不中（Windows 上必现）。
			entryPath = alignPathSeparators(entryPath, rootCwd);
			if (entryPath !== rootCwd && !createFileExplorerVisibility(rootCwd, preferences)(entryPath)) {
				throw new Error("Path is hidden by the file explorer display settings");
			}
			const directories: string[] = [rootCwd];
			let parent = pathDirname(entryPath);
			while (parent !== rootCwd && isSubPath(parent, rootCwd)) {
				directories.splice(1, 0, parent);
				const next = pathDirname(parent);
				if (next === parent) break;
				parent = next;
			}
			for (const directory of directories) await loadDir(directory);
			setExpandedDirs((previous) => {
				const next = new Set(previous);
				for (const directory of directories.slice(1)) next.add(directory);
				return next;
			});
		},
		[rootCwd, loadDir, setExpandedDirs, preferences],
	);

	// When the resolved cwd changes, clear cache and load new root
	useEffect(() => {
		if (rootCwd === prevCwdRef.current) return;
		prevCwdRef.current = rootCwd;

		setCache(new Map());
		setExpandedDirs(new Set());
		setLoadingDirs(new Set());

		if (rootCwd) {
			void loadDir(rootCwd);
		}
	}, [rootCwd, setCache, setExpandedDirs, setLoadingDirs, loadDir]);

	// Watch expanded directories + root for filesystem changes.
	// 登记的键是 `watchPathKey`，主进程广播回来的是 resolve 过的路径；
	// 换目录时只做增量 diff，不在每次展开时把所有 watcher 拆掉重建——
	// 那段空窗期里发生的变化在 Windows 上会直接丢掉。
	const watchedDirsRef = useRef<Map<string, string>>(new Map());
	useEffect(() => {
		const desired = new Map<string, string>();
		if (rootCwd) desired.set(watchPathKey(rootCwd), rootCwd);
		for (const dir of expandedDirs) desired.set(watchPathKey(dir), dir);

		const previous = watchedDirsRef.current;

		for (const [key, dir] of desired) {
			if (!previous.has(key)) void window.astravia.fs.watchDir(dir);
		}
		for (const [key, dir] of previous) {
			if (!desired.has(key)) void window.astravia.fs.unwatchDir(dir);
		}

		watchedDirsRef.current = desired;
	}, [rootCwd, expandedDirs]);

	// Unmount 才放掉全部 watcher。
	useEffect(() => {
		return () => {
			// 必须读卸载时的当前值：上面的 effect 每次都会整体替换这个 Map，
			// 捕获挂载瞬间那个空 Map 会漏掉后来挂上的监听。
			for (const dir of watchedDirsRef.current.values()) void window.astravia.fs.unwatchDir(dir);
			watchedDirsRef.current.clear();
		};
	}, []);

	// Subscribe to dir-changed events from main process
	useEffect(() => {
		const scheduler = createDirectoryReloadScheduler((changedPath: string) => {
			const watchedDir = watchedDirsRef.current.get(watchPathKey(changedPath));
			emitPluginFileExplorerFilesChanged([{ type: "changed", path: watchedDir ?? changedPath }]);
			// 用渲染层自己那份路径重新读，否则缓存里会多出一份只在大小写/分隔符上不同的键。
			if (watchedDir !== undefined) void loadDir(watchedDir);
		});
		const unsub = window.astravia.fs.onDirChanged((dirPath: string) => {
			scheduler.notify(dirPath);
		});
		return () => {
			unsub();
			scheduler.dispose();
		};
	}, [loadDir]);

	return {
		cache: visibleCache,
		expandedDirs,
		loadingDirs,
		rootDir: rootCwd,
		toggleDir,
		expandDir,
		collapseAll,
		renameEntry,
		deleteEntry,
		moveEntry,
		refreshDir,
		revealPath,
	};
}
