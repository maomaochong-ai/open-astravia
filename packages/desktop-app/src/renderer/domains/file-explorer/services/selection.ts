export interface FileExplorerSelectionState {
	/** Ordered selection paths (last entry is primary / focused when present). */
	paths: readonly string[];
	/** Anchor for shift-range selection. */
	anchorPath: string | null;
	/** Keyboard / visual focus path. */
	focusedPath: string | null;
}

export interface FileExplorerSelectGesture {
	toggle: boolean;
	range: boolean;
	/** Plain click / Enter — replace selection and activate. */
	activate: boolean;
}

export const EMPTY_FILE_EXPLORER_SELECTION: FileExplorerSelectionState = {
	paths: [],
	anchorPath: null,
	focusedPath: null,
};

export function buildFileTreeFlatPaths(
	rootDir: string,
	cache: ReadonlyMap<string, readonly { path: string; isDirectory: boolean }[]>,
	expandedDirs: ReadonlySet<string>,
): string[] {
	const result: string[] = [];

	function walk(dirPath: string): void {
		const entries = cache.get(dirPath);
		if (!entries) return;
		for (const entry of entries) {
			result.push(entry.path);
			if (entry.isDirectory && expandedDirs.has(entry.path)) {
				walk(entry.path);
			}
		}
	}

	walk(rootDir);
	return result;
}

export function applyFileExplorerSelection(
	state: FileExplorerSelectionState,
	flatPaths: readonly string[],
	targetPath: string,
	gesture: FileExplorerSelectGesture,
): FileExplorerSelectionState {
	if (gesture.toggle) {
		const set = new Set(state.paths);
		if (set.has(targetPath)) set.delete(targetPath);
		else set.add(targetPath);
		const paths = flatPaths.filter((path) => set.has(path));
		return {
			paths,
			anchorPath: targetPath,
			focusedPath: targetPath,
		};
	}

	if (gesture.range && state.anchorPath) {
		const start = flatPaths.indexOf(state.anchorPath);
		const end = flatPaths.indexOf(targetPath);
		if (start >= 0 && end >= 0) {
			const from = Math.min(start, end);
			const to = Math.max(start, end);
			return {
				paths: flatPaths.slice(from, to + 1),
				anchorPath: state.anchorPath,
				focusedPath: targetPath,
			};
		}
	}

	return {
		paths: [targetPath],
		anchorPath: targetPath,
		focusedPath: targetPath,
	};
}

export function selectAllVisible(flatPaths: readonly string[]): FileExplorerSelectionState {
	if (flatPaths.length === 0) return EMPTY_FILE_EXPLORER_SELECTION;
	return {
		paths: [...flatPaths],
		anchorPath: flatPaths[0] ?? null,
		focusedPath: flatPaths[flatPaths.length - 1] ?? null,
	};
}

export function moveFileExplorerFocus(
	state: FileExplorerSelectionState,
	flatPaths: readonly string[],
	delta: number,
	extend: boolean,
): FileExplorerSelectionState {
	if (flatPaths.length === 0) return EMPTY_FILE_EXPLORER_SELECTION;
	const current = state.focusedPath ?? state.paths[state.paths.length - 1] ?? null;
	const currentIndex = current ? flatPaths.indexOf(current) : -1;
	const nextIndex = Math.max(0, Math.min(flatPaths.length - 1, (currentIndex < 0 ? 0 : currentIndex) + delta));
	const nextPath = flatPaths[nextIndex];
	if (!nextPath) return state;

	if (extend) {
		const anchor = state.anchorPath ?? current ?? nextPath;
		const start = flatPaths.indexOf(anchor);
		const from = Math.min(start, nextIndex);
		const to = Math.max(start, nextIndex);
		return {
			paths: flatPaths.slice(from, to + 1),
			anchorPath: anchor,
			focusedPath: nextPath,
		};
	}

	return {
		paths: [nextPath],
		anchorPath: nextPath,
		focusedPath: nextPath,
	};
}

export function pruneSelectionToExisting(
	state: FileExplorerSelectionState,
	existingPaths: ReadonlySet<string>,
): FileExplorerSelectionState {
	const paths = state.paths.filter((path) => existingPaths.has(path));
	const anchorPath = state.anchorPath && existingPaths.has(state.anchorPath) ? state.anchorPath : (paths[0] ?? null);
	const focusedPath =
		state.focusedPath && existingPaths.has(state.focusedPath) ? state.focusedPath : (paths[paths.length - 1] ?? null);
	return { paths, anchorPath, focusedPath };
}

/**
 * Apply a marquee frame's full path set (hits, or base∪hits for additive).
 * Paths are re-ordered by the current flat tree order.
 */
export function applyMarqueeSelection(
	flatPaths: readonly string[],
	selectedPaths: readonly string[],
	previous: FileExplorerSelectionState | null = null,
): FileExplorerSelectionState {
	const selected = new Set(selectedPaths);
	const ordered = flatPaths.filter((path) => selected.has(path));
	if (ordered.length === 0) return EMPTY_FILE_EXPLORER_SELECTION;
	return {
		paths: ordered,
		// Keep prior anchor when extending an existing multi-select via additive marquee.
		anchorPath:
			previous?.anchorPath && selected.has(previous.anchorPath) ? previous.anchorPath : (ordered[0] ?? null),
		focusedPath: ordered[ordered.length - 1] ?? null,
	};
}
