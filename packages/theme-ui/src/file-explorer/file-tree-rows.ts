import type { FileExplorerCreatingEntry, FileExplorerEntry, FileExplorerEntryKind } from "./types";

/**
 * Initial row-height estimate (`py-[3px]` + `text-[12px]` at the preflight
 * `line-height: 1.5`). Only used until the virtual list has measured a row:
 * marquee hit-testing reads measured heights through {@link FileTreeRowMetrics},
 * so this constant can never misplace a hit once rows are on screen.
 */
export const FILE_TREE_ROW_HEIGHT = 24;
/** Pixel overscan so keyboard/marquee hits near the edge stay mounted. */
export const FILE_TREE_OVERSCAN = 160;

export type FileTreeEntryRow = {
	type: "entry";
	key: string;
	depth: number;
	entry: FileExplorerEntry;
};

export type FileTreeCreateRowModel = {
	type: "create";
	key: string;
	depth: number;
	parentPath: string;
	kind: FileExplorerEntryKind;
};

export type FileTreeRow = FileTreeEntryRow | FileTreeCreateRowModel;

export interface BuildFileTreeRowsInput {
	rootDir: string;
	cache: ReadonlyMap<string, readonly FileExplorerEntry[]>;
	expandedDirs: ReadonlySet<string>;
	creatingEntry: FileExplorerCreatingEntry | null;
}

export interface FileTreeMarqueeRect {
	left: number;
	top: number;
	width: number;
	height: number;
}

/** Row geometry source for hit-testing: measured px when known, an estimate otherwise. */
export interface FileTreeRowMetrics {
	rowHeight(row: FileTreeRow): number;
}

export interface FileTreeRowHeightStore extends FileTreeRowMetrics {
	/** Record the measured height of a mounted row (keyed by `FileTreeRow.key`). */
	record(key: string, height: number): void;
	/** Drop measurements for rows that no longer exist. */
	prune(liveKeys: ReadonlySet<string>): void;
	/** Average measured height, or the fallback before anything was measured. */
	estimatedRowHeight(): number;
}

/**
 * Keeps the heights the virtual list measured for mounted rows so geometry
 * hit-tests (marquee) line up with what is actually painted. Unmounted rows use
 * the average measured height, which matches how Virtuoso places items it has
 * not measured yet.
 */
export function createFileTreeRowHeightStore(fallbackHeight: number = FILE_TREE_ROW_HEIGHT): FileTreeRowHeightStore {
	const heights = new Map<string, number>();
	let sum = 0;

	function estimatedRowHeight(): number {
		return heights.size === 0 ? fallbackHeight : sum / heights.size;
	}

	return {
		record(key, height) {
			if (!Number.isFinite(height) || height <= 0) return;
			const previous = heights.get(key);
			if (previous === height) return;
			if (previous !== undefined) sum -= previous;
			heights.set(key, height);
			sum += height;
		},
		prune(liveKeys) {
			for (const [key, height] of heights) {
				if (liveKeys.has(key)) continue;
				heights.delete(key);
				sum -= height;
			}
		},
		estimatedRowHeight,
		rowHeight(row) {
			return heights.get(row.key) ?? estimatedRowHeight();
		},
	};
}

function createRowKey(parentPath: string, kind: FileExplorerEntryKind): string {
	return `create:${parentPath}:${kind}`;
}

function pushCreateRow(result: FileTreeRow[], creatingEntry: FileExplorerCreatingEntry, depth: number): void {
	result.push({
		type: "create",
		key: createRowKey(creatingEntry.parentPath, creatingEntry.kind),
		depth,
		parentPath: creatingEntry.parentPath,
		kind: creatingEntry.kind,
	});
}

/**
 * Flatten the visible tree in the same order as the previous full mount:
 * root create row, then each entry followed by an inline create row for that
 * entry, then expanded children.
 */
export function buildFileTreeRows({
	rootDir,
	cache,
	expandedDirs,
	creatingEntry,
}: BuildFileTreeRowsInput): FileTreeRow[] {
	const result: FileTreeRow[] = [];
	if (creatingEntry?.parentPath === rootDir) {
		pushCreateRow(result, creatingEntry, 0);
	}

	function walk(dirPath: string, depth: number): void {
		const entries = cache.get(dirPath);
		if (!entries) return;
		for (const entry of entries) {
			result.push({ type: "entry", key: entry.path, depth, entry });
			if (creatingEntry?.parentPath === entry.path) {
				pushCreateRow(result, creatingEntry, depth + 1);
			}
			if (entry.isDirectory && expandedDirs.has(entry.path)) {
				walk(entry.path, depth + 1);
			}
		}
	}

	walk(rootDir, 0);
	return result;
}

/**
 * Hit-test a content-space marquee against row geometry.
 * Off-screen rows stay selectable because this does not read the DOM; rows are
 * stacked top-to-bottom using `metrics` (a fixed height or measured heights).
 */
export function hitTestFileTreeMarquee(
	rows: readonly FileTreeRow[],
	rect: FileTreeMarqueeRect,
	metrics: number | FileTreeRowMetrics = FILE_TREE_ROW_HEIGHT,
): string[] {
	if (rows.length === 0 || rect.width <= 0 || rect.height <= 0) return [];
	if (typeof metrics === "number" && metrics <= 0) return [];
	const top = rect.top;
	const bottom = top + rect.height;
	const hits: string[] = [];
	let rowTop = 0;
	for (const row of rows) {
		if (rowTop >= bottom) break;
		const height = typeof metrics === "number" ? metrics : metrics.rowHeight(row);
		if (!(height > 0)) continue;
		const rowBottom = rowTop + height;
		if (rowBottom > top && row.type === "entry") hits.push(row.entry.path);
		rowTop = rowBottom;
	}
	return hits;
}
