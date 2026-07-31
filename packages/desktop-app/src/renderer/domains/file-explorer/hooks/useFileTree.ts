import { isSubPath, pathBasename, pathDirname, pathJoin } from "@shared/lib/utils";
import {
	activeSessionAtom,
	expandedDirsAtom,
	type FsEntry,
	fileTreeCacheAtom,
	loadingDirsAtom,
} from "@shared/store/atoms";
import { useAtom, useAtomValue } from "jotai";
import { useCallback, useEffect, useRef } from "react";
import { emitPluginFileExplorerFilesChanged } from "../../plugins/runtime/plugin-file-explorer-host";

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

	const loadDir = useCallback(
		async (dirPath: string) => {
			setLoadingDirs((prev) => new Set([...prev, dirPath]));
			try {
				const entries = await window.vetta.fs.readDir(dirPath);
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
			await window.vetta.fs.rename(oldPath, newPath);
			emitPluginFileExplorerFilesChanged([{ type: "moved", oldPath, path: newPath }]);
			// Refresh parent directory
			const parentDir = pathDirname(oldPath);
			await loadDir(parentDir);
		},
		[loadDir],
	);

	const deleteEntry = useCallback(
		async (entryPath: string) => {
			await window.vetta.fs.delete(entryPath);
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
				await window.vetta.fs.move(srcPath, destDir);
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
		[rootCwd, loadDir, setExpandedDirs],
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

	// Watch expanded directories + root for filesystem changes
	const watchedDirsRef = useRef<Set<string>>(new Set());
	useEffect(() => {
		const dirsToWatch = new Set<string>();
		if (rootCwd) dirsToWatch.add(rootCwd);
		for (const dir of expandedDirs) dirsToWatch.add(dir);

		const prev = watchedDirsRef.current;

		// Start watching new dirs
		for (const dir of dirsToWatch) {
			if (!prev.has(dir)) {
				void window.vetta.fs.watchDir(dir);
			}
		}
		// Stop watching removed dirs
		for (const dir of prev) {
			if (!dirsToWatch.has(dir)) {
				void window.vetta.fs.unwatchDir(dir);
			}
		}

		watchedDirsRef.current = dirsToWatch;

		return () => {
			// Cleanup on unmount: unwatch all
			for (const dir of watchedDirsRef.current) {
				void window.vetta.fs.unwatchDir(dir);
			}
			watchedDirsRef.current = new Set();
		};
	}, [rootCwd, expandedDirs]);

	// Subscribe to dir-changed events from main process
	useEffect(() => {
		const unsub = window.vetta.fs.onDirChanged((dirPath: string) => {
			emitPluginFileExplorerFilesChanged([{ type: "changed", path: dirPath }]);
			// Only reload if this dir is currently visible (root or expanded)
			if (watchedDirsRef.current.has(dirPath)) {
				void loadDir(dirPath);
			}
		});
		return unsub;
	}, [loadDir]);

	return {
		cache,
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
