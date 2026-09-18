import type { FileExplorerCreatingEntry, FileExplorerEntry, FileExplorerEntryKind } from "./types";

/** Matches `py-[3px]` + `text-[12px]` file-tree rows. */
export const FILE_TREE_ROW_HEIGHT = 22;
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
 * Off-screen rows stay selectable because this does not read the DOM.
 */
export function hitTestFileTreeMarquee(
	rows: readonly FileTreeRow[],
	rect: FileTreeMarqueeRect,
	rowHeight: number = FILE_TREE_ROW_HEIGHT,
): string[] {
	if (rows.length === 0 || rect.width <= 0 || rect.height <= 0 || rowHeight <= 0) return [];
	const top = rect.top;
	const bottom = top + rect.height;
	const start = Math.max(0, Math.floor(top / rowHeight));
	const end = Math.min(rows.length - 1, Math.ceil(bottom / rowHeight) - 1);
	if (end < start) return [];
	const hits: string[] = [];
	for (let index = start; index <= end; index++) {
		const row = rows[index];
		if (row?.type === "entry") hits.push(row.entry.path);
	}
	return hits;
}
