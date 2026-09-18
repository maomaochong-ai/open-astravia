import {
	type DragEvent,
	type FocusEvent,
	type JSX,
	type KeyboardEvent,
	type MouseEvent,
	useCallback,
	useEffect,
	useId,
	useMemo,
	useRef,
	useState,
} from "react";
import { type VirtuosoHandle, Virtuoso } from "react-virtuoso";
import { FILE_TREE_ROOT_DROP_CLASS, isDragLeavingElement } from "./drag-target";
import { fileTreeRowDomId, isFileTreeEditableTarget } from "./file-tree-dom";
import { FileTreeCreateRow } from "./FileTreeCreateRow";
import { FileTreeNodeView } from "./FileTreeNodeView";
import {
	type FileTreeRow,
	buildFileTreeRows,
	createFileTreeRowHeightStore,
	FILE_TREE_OVERSCAN,
	FILE_TREE_ROW_HEIGHT,
} from "./file-tree-rows";
import type {
	FileExplorerCreatingEntry,
	FileExplorerDragEntry,
	FileExplorerEntry,
	FileExplorerNodeDecoration,
	FileExplorerSelectOptions,
} from "./types";
import { useFileTreeMarqueeSelection } from "./useFileTreeMarqueeSelection";

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
	/** Replace selection with the given paths (marquee). Paths may be empty to clear. */
	onSelectPaths: (paths: readonly string[]) => void;
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

function toScrollerElement(ref: HTMLElement | Window | null): HTMLElement | null {
	return ref instanceof HTMLElement ? ref : null;
}

/** Virtuoso stamps the measured item wrapper with `data-item-index` (`data-index` on older builds). */
function readVirtuosoItemIndex(el: HTMLElement): number {
	const raw = el.dataset.itemIndex ?? el.dataset.index;
	const index = raw === undefined ? Number.NaN : Number(raw);
	return Number.isInteger(index) ? index : -1;
}

/**
 * Flattened, virtualized file tree. Host owns cache / expand / rename path atoms.
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
	onSelectPaths,
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
	const virtuosoRef = useRef<VirtuosoHandle>(null);
	const treeId = useId();
	const rowsRef = useRef<readonly FileTreeRow[]>([]);
	const [rootDragOver, setRootDragOver] = useState(false);
	const rows = useMemo(
		() => buildFileTreeRows({ rootDir, cache, expandedDirs, creatingEntry }),
		[rootDir, cache, expandedDirs, creatingEntry],
	);
	rowsRef.current = rows;
	// Measured heights win over FILE_TREE_ROW_HEIGHT so marquee geometry cannot drift from the painted rows.
	const [rowHeights] = useState(() => createFileTreeRowHeightStore(FILE_TREE_ROW_HEIGHT));
	useEffect(() => {
		rowHeights.prune(new Set(rows.map((row) => row.key)));
	}, [rows, rowHeights]);
	const measureItemSize = useCallback(
		(el: HTMLElement, field: "offsetHeight" | "offsetWidth"): number => {
			const size = el.getBoundingClientRect()[field === "offsetHeight" ? "height" : "width"];
			if (field === "offsetHeight") {
				const row = rowsRef.current[readVirtuosoItemIndex(el)];
				if (row) rowHeights.record(row.key, size);
			}
			return size;
		},
		[rowHeights],
	);
	const selectedDragEntries: FileExplorerDragEntry[] = useMemo(
		() =>
			rows
				.filter((row): row is Extract<FileTreeRow, { type: "entry" }> => row.type === "entry")
				.map((row) => row.entry)
				.filter((entry) => selectedPaths.has(entry.path))
				.map((entry) => ({ path: entry.path, name: entry.name, isDirectory: entry.isDirectory })),
		[rows, selectedPaths],
	);

	// The rename draft lives here, not in the row: Virtuoso recycles rows that scroll out of
	// the overscan window, and a row-local draft would be lost (or committed) on that unmount.
	const [renameDraft, setRenameDraft] = useState<{ path: string; value: string } | null>(null);
	useEffect(() => {
		if (!renamingPath) {
			setRenameDraft(null);
			return;
		}
		const row = rowsRef.current.find((candidate) => candidate.type === "entry" && candidate.entry.path === renamingPath);
		const name = row?.type === "entry" ? row.entry.name : "";
		setRenameDraft((prev) => (prev?.path === renamingPath ? prev : { path: renamingPath, value: name }));
	}, [renamingPath]);
	const handleRenameValueChange = useCallback(
		(value: string) => {
			if (!renamingPath) return;
			setRenameDraft({ path: renamingPath, value });
		},
		[renamingPath],
	);
	const handleRenameSubmit = useCallback(
		(oldPath: string, newName: string) => {
			setRenameDraft(null);
			onRenameSubmit(oldPath, newName);
		},
		[onRenameSubmit],
	);
	const handleRenameCancel = useCallback(() => {
		setRenameDraft(null);
		onRenameCancel();
	}, [onRenameCancel]);

	const handleMarqueeSelect = useCallback(
		(paths: readonly string[]) => {
			onSelectPaths(paths);
		},
		[onSelectPaths],
	);
	const { scrollRef, marquee, onMouseDown: onMarqueeMouseDown } = useFileTreeMarqueeSelection({
		selectedPaths,
		onMarqueeSelect: handleMarqueeSelect,
		rows,
		rowMetrics: rowHeights,
	});

	// Keyboard focus stays on the tree container (rows are recycled by the virtual list, so a
	// focused row element would drop focus to <body> when it scrolls out). The active row is
	// announced through aria-activedescendant and kept in view through Virtuoso, which only
	// scrolls when the row is outside the viewport.
	const focusedIndex = useMemo(
		() => (focusedPath ? rows.findIndex((row) => row.type === "entry" && row.entry.path === focusedPath) : -1),
		[rows, focusedPath],
	);
	const focusedRow = focusedIndex >= 0 ? rows[focusedIndex] : undefined;
	const focusedEntry = focusedRow?.type === "entry" ? focusedRow.entry : null;
	const revealFocusedRow = useCallback(() => {
		const index = focusedPath
			? rowsRef.current.findIndex((row) => row.type === "entry" && row.entry.path === focusedPath)
			: -1;
		if (index >= 0) virtuosoRef.current?.scrollIntoView({ index });
	}, [focusedPath]);
	useEffect(() => {
		revealFocusedRow();
	}, [revealFocusedRow]);

	function handleTreeFocus(event: FocusEvent<HTMLDivElement>): void {
		// Rename / create inputs manage their own visibility; only chrome focus reveals the active row.
		if (isFileTreeEditableTarget(event.target)) return;
		revealFocusedRow();
	}

	function handleTreeKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
		onTreeKeyDown?.(event);
		if (event.defaultPrevented || event.key !== "Enter") return;
		if (isFileTreeEditableTarget(event.target) || renamingPath || creatingEntry || !focusedEntry) return;
		event.preventDefault();
		onSelectEntry(focusedEntry, { toggle: false, range: false, activate: true });
		if (focusedEntry.isDirectory) onToggleDir(focusedEntry.path);
	}

	function handleRootDragOver(event: DragEvent): void {
		const types = Array.from(event.dataTransfer.types);
		const internal = types.includes("application/vetta-path");
		if (!internal && !types.includes("Files")) return;
		event.preventDefault();
		event.dataTransfer.dropEffect = internal ? "move" : "copy";
		setRootDragOver(true);
	}

	function handleRootDragLeave(event: DragEvent): void {
		if (!isDragLeavingElement(event)) return;
		setRootDragOver(false);
	}

	function handleRootDrop(event: DragEvent): void {
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

	function renderRow(index: number, row: FileTreeRow): JSX.Element {
		if (row.type === "create") {
			return (
				<FileTreeCreateRow
					kind={row.kind}
					depth={row.depth}
					inputLabel={createInputLabel}
					error={creatingEntry?.error ?? null}
					busy={creatingEntry?.busy ?? false}
					onSubmit={onCreateSubmit}
					onCancel={onCreateCancel}
				/>
			);
		}
		const isSelected = selectedPaths.has(row.entry.path);
		const dragEntries: FileExplorerDragEntry[] =
			isSelected && selectedDragEntries.length > 0
				? selectedDragEntries
				: [
						{
							path: row.entry.path,
							name: row.entry.name,
							isDirectory: row.entry.isDirectory,
						},
					];
		return (
			<FileTreeNodeView
				rowId={fileTreeRowDomId(treeId, index)}
				entry={row.entry}
				depth={row.depth}
				isExpanded={expandedDirs.has(row.entry.path)}
				isLoading={loadingDirs.has(row.entry.path)}
				isSelected={isSelected}
				isFocused={focusedPath === row.entry.path}
				isRenaming={renamingPath === row.entry.path}
				renameValue={renameDraft?.path === row.entry.path ? renameDraft.value : undefined}
				onRenameValueChange={handleRenameValueChange}
				decoration={getDecoration?.(row.entry)}
				dragEntries={dragEntries}
				onToggleDir={onToggleDir}
				onSelectEntry={onSelectEntry}
				onContextMenu={onContextMenu}
				onRenameSubmit={handleRenameSubmit}
				onRenameCancel={handleRenameCancel}
				onFileMove={onFileMove}
				onExternalDrop={onExternalDrop}
				onNativeDragStart={onNativeDragStart}
				onPrefetchNativeDragIcons={onPrefetchNativeDragIcons}
			/>
		);
	}

	const viewportMarquee = marquee
		? {
				left: marquee.left - (scrollRef.current?.scrollLeft ?? 0),
				top: marquee.top - (scrollRef.current?.scrollTop ?? 0),
				width: marquee.width,
				height: marquee.height,
			}
		: null;

	if (rows.length === 0 && !loadingDirs.has(rootDir)) {
		return (
			// biome-ignore lint/a11y/noStaticElementInteractions: marquee selection on empty chrome
			<div
				ref={(node) => {
					scrollRef.current = node;
				}}
				role="tree"
				tabIndex={0}
				data-file-tree-root={rootDir}
				onClick={handleBackgroundClick}
				onContextMenu={handleRootContextMenu}
				onMouseDown={onMarqueeMouseDown}
				onDragOver={handleRootDragOver}
				onDragLeave={handleRootDragLeave}
				onDrop={handleRootDrop}
				onKeyDown={handleTreeKeyDown}
				className={`flex h-full min-h-0 items-center justify-center overflow-y-auto px-4 py-6 text-center text-[11px] text-muted-foreground outline-none select-none ${rootDragOver ? FILE_TREE_ROOT_DROP_CLASS : ""}`}
			>
				{emptyLabel}
			</div>
		);
	}

	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: marquee selection and tree keyboard on the host chrome
		<div
			role="tree"
			tabIndex={0}
			aria-activedescendant={focusedIndex >= 0 ? fileTreeRowDomId(treeId, focusedIndex) : undefined}
			data-file-tree-root={rootDir}
			className={`relative h-full min-h-0 overflow-hidden outline-none select-none ${rootDragOver ? FILE_TREE_ROOT_DROP_CLASS : ""}`}
			onClick={handleBackgroundClick}
			onContextMenu={handleRootContextMenu}
			onMouseDown={onMarqueeMouseDown}
			onDragOver={handleRootDragOver}
			onDragLeave={handleRootDragLeave}
			onDrop={handleRootDrop}
			onFocus={handleTreeFocus}
			onKeyDown={handleTreeKeyDown}
		>
			<Virtuoso
				ref={virtuosoRef}
				data={rows}
				defaultItemHeight={FILE_TREE_ROW_HEIGHT}
				itemSize={measureItemSize}
				overscan={FILE_TREE_OVERSCAN}
				computeItemKey={(_index, row) => row.key}
				scrollerRef={(ref) => {
					scrollRef.current = toScrollerElement(ref);
				}}
				itemContent={(index, row) => renderRow(index, row)}
				className="h-full"
				style={{ height: "100%" }}
			/>
			{viewportMarquee ? (
				<div
					className="pointer-events-none absolute z-10 rounded-sm border border-primary/50 bg-primary/10"
					style={viewportMarquee}
				/>
			) : null}
		</div>
	);
}
