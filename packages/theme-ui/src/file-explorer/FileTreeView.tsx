import { Fragment, useState, type JSX, type KeyboardEvent, type MouseEvent } from "react";
import { FILE_TREE_ROOT_DROP_CLASS, isDragLeavingElement } from "./drag-target";
import { FileTreeCreateRow } from "./FileTreeCreateRow";
import { FileTreeNodeView } from "./FileTreeNodeView";
import type {
	FileExplorerCreatingEntry,
	FileExplorerDragEntry,
	FileExplorerEntry,
	FileExplorerNodeDecoration,
	FileExplorerSelectOptions,
} from "./types";

export interface FileTreeViewProps {
	rootDir: string;
	/** dir path → children */
	cache: ReadonlyMap<string, readonly FileExplorerEntry[]>;
	expandedDirs: ReadonlySet<string>;
	loadingDirs: ReadonlySet<string>;
	selectedPaths: ReadonlySet<string>;
	focusedPath: string | null;
	renamingPath: string | null;
	creatingEntry: FileExplorerCreatingEntry | null;
	emptyLabel: string;
	createInputLabel: string;
	getDecoration?: (entry: FileExplorerEntry) => FileExplorerNodeDecoration | null;
	onToggleDir: (path: string) => void;
	onSelectEntry: (entry: FileExplorerEntry, options: FileExplorerSelectOptions) => void;
	/** Left-click empty area (not a row) — host should clear selection. */
	onBackgroundClick: () => void;
	onContextMenu: (entry: FileExplorerEntry, x: number, y: number) => void;
	/** Right-click empty area / tree chrome — host should clear selection + open root menu. */
	onRootContextMenu: (x: number, y: number) => void;
	onRenameSubmit: (oldPath: string, newName: string) => void;
	onRenameCancel: () => void;
	onCreateSubmit: (name: string) => void;
	onCreateCancel: () => void;
	onFileMove: (srcPaths: readonly string[], destDir: string) => void;
	onExternalDrop: (files: readonly File[], destDir: string) => void;
	onNativeDragStart: (paths: readonly string[]) => void;
	/** Warm app file-type icons before dragstart (e.g. pointerdown / selection). */
	onPrefetchNativeDragIcons?: (entries: readonly FileExplorerDragEntry[]) => void;
	onTreeKeyDown?: (event: KeyboardEvent<HTMLDivElement>) => void;
}

interface FlatNode {
	entry: FileExplorerEntry;
	depth: number;
}

function buildFlatList(
	rootDir: string,
	cache: ReadonlyMap<string, readonly FileExplorerEntry[]>,
	expandedDirs: ReadonlySet<string>,
): FlatNode[] {
	const result: FlatNode[] = [];

	function walk(dirPath: string, depth: number) {
		const entries = cache.get(dirPath);
		if (!entries) return;
		for (const entry of entries) {
			result.push({ entry, depth });
			if (entry.isDirectory && expandedDirs.has(entry.path)) {
				walk(entry.path, depth + 1);
			}
		}
	}

	walk(rootDir, 0);
	return result;
}

function parseInternalDragPaths(raw: string): string[] {
	if (!raw) return [];
	try {
		const parsed: unknown = JSON.parse(raw);
		if (Array.isArray(parsed)) {
			return parsed.filter((item): item is string => typeof item === "string" && item.length > 0);
		}
	} catch {
		// legacy single-path payload
	}
	return raw ? [raw] : [];
}

function isTreeBackgroundTarget(target: EventTarget | null): boolean {
	if (!(target instanceof Element)) return false;
	// Rows, inline rename/create inputs, and chevrons live under [data-file-path] or inputs.
	if (target.closest("[data-file-path]")) return false;
	if (target.closest("input")) return false;
	return true;
}

/**
 * Flattened file tree. Host owns cache / expand / rename path atoms.
 */
export function FileTreeView({
	rootDir,
	cache,
	expandedDirs,
	loadingDirs,
	selectedPaths,
	focusedPath,
	renamingPath,
	creatingEntry,
	emptyLabel,
	createInputLabel,
	getDecoration,
	onToggleDir,
	onSelectEntry,
	onBackgroundClick,
	onContextMenu,
	onRootContextMenu,
	onRenameSubmit,
	onRenameCancel,
	onCreateSubmit,
	onCreateCancel,
	onFileMove,
	onExternalDrop,
	onNativeDragStart,
	onPrefetchNativeDragIcons,
	onTreeKeyDown,
}: FileTreeViewProps): JSX.Element {
	const [rootDragOver, setRootDragOver] = useState(false);
	const flatList = buildFlatList(rootDir, cache, expandedDirs);
	const selectedDragEntries: FileExplorerDragEntry[] = flatList
		.map((node) => node.entry)
		.filter((entry) => selectedPaths.has(entry.path))
		.map((entry) => ({ path: entry.path, name: entry.name, isDirectory: entry.isDirectory }));

	function handleRootDragOver(event: React.DragEvent): void {
		const types = Array.from(event.dataTransfer.types);
		const internal = types.includes("application/vetta-path");
		if (!internal && !types.includes("Files")) return;
		event.preventDefault();
		event.dataTransfer.dropEffect = internal ? "move" : "copy";
		setRootDragOver(true);
	}

	function handleRootDragLeave(event: React.DragEvent): void {
		if (!isDragLeavingElement(event)) return;
		setRootDragOver(false);
	}

	function handleRootDrop(event: React.DragEvent): void {
		setRootDragOver(false);
		event.preventDefault();
		const sourceRaw = event.dataTransfer.getData("application/vetta-path");
		if (sourceRaw) {
			const paths = parseInternalDragPaths(sourceRaw);
			if (paths.length > 0) onFileMove(paths, rootDir);
			return;
		}
		const files = Array.from(event.dataTransfer.files);
		if (files.length > 0) onExternalDrop(files, rootDir);
	}

	function handleBackgroundClick(event: MouseEvent): void {
		if (!isTreeBackgroundTarget(event.target)) return;
		onBackgroundClick();
	}

	function handleRootContextMenu(event: MouseEvent): void {
		event.preventDefault();
		if (!isTreeBackgroundTarget(event.target)) return;
		onRootContextMenu(event.clientX, event.clientY);
	}

	const rootCreateRow = creatingEntry?.parentPath === rootDir ? (
		<FileTreeCreateRow
			key={`${creatingEntry.parentPath}:${creatingEntry.kind}`}
			kind={creatingEntry.kind}
			depth={0}
			inputLabel={createInputLabel}
			error={creatingEntry.error}
			busy={creatingEntry.busy}
			onSubmit={onCreateSubmit}
			onCancel={onCreateCancel}
		/>
	) : null;

	const treeClass = `min-h-full py-0.5 transition-colors outline-none ${rootDragOver ? FILE_TREE_ROOT_DROP_CLASS : ""}`;

	if (flatList.length === 0 && !loadingDirs.has(rootDir) && !rootCreateRow) {
		return (
			<div
				role="tree"
				tabIndex={0}
				onClick={handleBackgroundClick}
				onContextMenu={handleRootContextMenu}
				onDragOver={handleRootDragOver}
				onDragLeave={handleRootDragLeave}
				onDrop={handleRootDrop}
				onKeyDown={onTreeKeyDown}
				className={`flex min-h-full items-center justify-center px-4 py-6 text-center text-[11px] text-muted-foreground transition-colors outline-none ${rootDragOver ? FILE_TREE_ROOT_DROP_CLASS : ""}`}
			>
				{emptyLabel}
			</div>
		);
	}

	return (
		<div
			role="tree"
			tabIndex={0}
			onClick={handleBackgroundClick}
			onContextMenu={handleRootContextMenu}
			onDragOver={handleRootDragOver}
			onDragLeave={handleRootDragLeave}
			onDrop={handleRootDrop}
			onKeyDown={onTreeKeyDown}
			className={treeClass}
		>
			{rootCreateRow}
			{flatList.map((node) => {
				const isSelected = selectedPaths.has(node.entry.path);
				const dragEntries: FileExplorerDragEntry[] =
					isSelected && selectedDragEntries.length > 0
						? selectedDragEntries
						: [
								{
									path: node.entry.path,
									name: node.entry.name,
									isDirectory: node.entry.isDirectory,
								},
							];
				return (
					<Fragment key={node.entry.path}>
						<FileTreeNodeView
							entry={node.entry}
							depth={node.depth}
							isExpanded={expandedDirs.has(node.entry.path)}
							isLoading={loadingDirs.has(node.entry.path)}
							isSelected={isSelected}
							isFocused={focusedPath === node.entry.path}
							isRenaming={renamingPath === node.entry.path}
							decoration={getDecoration?.(node.entry)}
							dragEntries={dragEntries}
							onToggleDir={onToggleDir}
							onSelectEntry={onSelectEntry}
							onContextMenu={onContextMenu}
							onRenameSubmit={onRenameSubmit}
							onRenameCancel={onRenameCancel}
							onFileMove={onFileMove}
							onExternalDrop={onExternalDrop}
							onNativeDragStart={onNativeDragStart}
							onPrefetchNativeDragIcons={onPrefetchNativeDragIcons}
						/>
						{creatingEntry?.parentPath === node.entry.path ? (
							<FileTreeCreateRow
								key={`${creatingEntry.parentPath}:${creatingEntry.kind}`}
								kind={creatingEntry.kind}
								depth={node.depth + 1}
								inputLabel={createInputLabel}
								error={creatingEntry.error}
								busy={creatingEntry.busy}
								onSubmit={onCreateSubmit}
								onCancel={onCreateCancel}
							/>
						) : null}
					</Fragment>
				);
			})}
		</div>
	);
}
