import { type FsEntry, fileTreeCacheAtom } from "@shared/store/atoms";
import type { FileExplorerSelectOptions } from "@vetta/theme-ui/file-explorer";
import { getDefaultStore } from "jotai";
import { useCallback, useEffect, useMemo, useState } from "react";
import { emitPluginFileExplorerSelectionChanged } from "../../plugins/runtime/plugin-file-explorer-host";
import {
	applyFileExplorerSelection,
	buildFileTreeFlatPaths,
	EMPTY_FILE_EXPLORER_SELECTION,
	type FileExplorerSelectionState,
	moveFileExplorerFocus,
	pruneSelectionToExisting,
	selectAllVisible,
} from "../services/selection";

function collectEntriesByPaths(cache: ReadonlyMap<string, readonly FsEntry[]>, paths: readonly string[]): FsEntry[] {
	const byPath = new Map<string, FsEntry>();
	for (const entries of cache.values()) {
		for (const entry of entries) byPath.set(entry.path, entry);
	}
	return paths.map((path) => byPath.get(path)).filter((entry): entry is FsEntry => entry != null);
}

/**
 * Single source of truth for file-tree selection.
 * Intentionally decoupled from preview state — highlighting only follows this model.
 */
export function useFileExplorerSelection(input: {
	rootDir: string | null;
	cache: ReadonlyMap<string, readonly FsEntry[]>;
	expandedDirs: ReadonlySet<string>;
}) {
	const [state, setState] = useState<FileExplorerSelectionState>(EMPTY_FILE_EXPLORER_SELECTION);

	const flatPaths = useMemo(
		() => (input.rootDir ? buildFileTreeFlatPaths(input.rootDir, input.cache, input.expandedDirs) : []),
		[input.rootDir, input.cache, input.expandedDirs],
	);

	const selectedPaths = useMemo(() => new Set(state.paths), [state.paths]);
	const selectedEntries = useMemo(() => collectEntriesByPaths(input.cache, state.paths), [input.cache, state.paths]);
	const focusedEntry = useMemo(() => {
		if (!state.focusedPath) return null;
		return collectEntriesByPaths(input.cache, [state.focusedPath])[0] ?? null;
	}, [input.cache, state.focusedPath]);

	const commit = useCallback((next: FileExplorerSelectionState) => {
		setState(next);
		const entries = collectEntriesByPaths(getDefaultStore().get(fileTreeCacheAtom), next.paths);
		emitPluginFileExplorerSelectionChanged(entries);
	}, []);

	const clear = useCallback(() => {
		commit(EMPTY_FILE_EXPLORER_SELECTION);
	}, [commit]);

	const selectEntry = useCallback(
		(entry: FsEntry, options: FileExplorerSelectOptions) => {
			setState((prev) => {
				const next = applyFileExplorerSelection(prev, flatPaths, entry.path, options);
				const entries = collectEntriesByPaths(getDefaultStore().get(fileTreeCacheAtom), next.paths);
				// Defer plugin emit out of the pure updater path via microtask.
				queueMicrotask(() => emitPluginFileExplorerSelectionChanged(entries));
				return next;
			});
		},
		[flatPaths],
	);

	/** Right-click: if already multi-selected, keep set; otherwise select the target alone. */
	const prepareContextTarget = useCallback((entry: FsEntry) => {
		setState((prev) => {
			if (prev.paths.includes(entry.path)) {
				if (prev.focusedPath === entry.path) return prev;
				return { ...prev, focusedPath: entry.path };
			}
			const next = {
				paths: [entry.path],
				anchorPath: entry.path,
				focusedPath: entry.path,
			};
			queueMicrotask(() =>
				emitPluginFileExplorerSelectionChanged(
					collectEntriesByPaths(getDefaultStore().get(fileTreeCacheAtom), next.paths),
				),
			);
			return next;
		});
	}, []);

	const selectAll = useCallback(() => {
		commit(selectAllVisible(flatPaths));
	}, [commit, flatPaths]);

	const moveFocus = useCallback(
		(delta: number, extend: boolean): FileExplorerSelectionState => {
			let result = EMPTY_FILE_EXPLORER_SELECTION;
			setState((prev) => {
				result = moveFileExplorerFocus(prev, flatPaths, delta, extend);
				const entries = collectEntriesByPaths(getDefaultStore().get(fileTreeCacheAtom), result.paths);
				queueMicrotask(() => emitPluginFileExplorerSelectionChanged(entries));
				return result;
			});
			return result;
		},
		[flatPaths],
	);

	const replaceWith = useCallback(
		(entry: FsEntry) => {
			commit({
				paths: [entry.path],
				anchorPath: entry.path,
				focusedPath: entry.path,
			});
		},
		[commit],
	);

	const entryByPath = useCallback(
		(path: string | null) => (path ? (collectEntriesByPaths(input.cache, [path])[0] ?? null) : null),
		[input.cache],
	);

	// Workspace switch resets selection completely.
	const workspaceRoot = input.rootDir;
	useEffect(() => {
		// Touch workspaceRoot so the dependency is intentional (reset on project switch).
		void workspaceRoot;
		commit(EMPTY_FILE_EXPLORER_SELECTION);
	}, [workspaceRoot, commit]);

	// Drop paths that disappeared after refresh / delete / collapse.
	useEffect(() => {
		const existing = new Set(flatPaths);
		setState((prev) => {
			const pruned = pruneSelectionToExisting(prev, existing);
			if (
				pruned.paths.length === prev.paths.length &&
				pruned.paths.every((path, index) => path === prev.paths[index]) &&
				pruned.anchorPath === prev.anchorPath &&
				pruned.focusedPath === prev.focusedPath
			) {
				return prev;
			}
			queueMicrotask(() => emitPluginFileExplorerSelectionChanged(collectEntriesByPaths(input.cache, pruned.paths)));
			return pruned;
		});
	}, [flatPaths, input.cache]);

	return useMemo(
		() => ({
			state,
			flatPaths,
			selectedPaths,
			selectedEntries,
			focusedEntry,
			focusedPath: state.focusedPath,
			clear,
			selectEntry,
			prepareContextTarget,
			selectAll,
			moveFocus,
			replaceWith,
			entryByPath,
		}),
		[
			state,
			flatPaths,
			selectedPaths,
			selectedEntries,
			focusedEntry,
			clear,
			selectEntry,
			prepareContextTarget,
			selectAll,
			moveFocus,
			replaceWith,
			entryByPath,
		],
	);
}
