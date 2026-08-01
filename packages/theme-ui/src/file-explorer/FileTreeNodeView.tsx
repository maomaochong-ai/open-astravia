import { cn } from "@vetta/ui";
import { useEffect, useRef, useState, type JSX } from "react";
import { FILE_TREE_NODE_DROP_CLASS, isDragLeavingElement } from "./drag-target";
import { getFileIcon } from "./fileIcons";
import { beginNativeFileDrag } from "./nativeFileDrag";
import type { FileExplorerEntry, FileExplorerNodeDecoration, FileExplorerSelectOptions } from "./types";

const DRAG_MIME = "application/vetta-path";

export interface FileTreeNodeViewProps {
	entry: FileExplorerEntry;
	depth: number;
	isExpanded: boolean;
	isLoading: boolean;
	isSelected: boolean;
	isFocused?: boolean;
	isRenaming: boolean;
	decoration?: FileExplorerNodeDecoration | null;
	/** Paths included in the active multi-select when dragging this row. */
	dragPaths?: readonly string[];
	onToggleDir: (path: string) => void;
	onSelectEntry: (entry: FileExplorerEntry, options: FileExplorerSelectOptions) => void;
	onContextMenu: (entry: FileExplorerEntry, x: number, y: number) => void;
	onRenameSubmit: (oldPath: string, newName: string) => void;
	onRenameCancel: () => void;
	/** Called when path(s) are dropped onto this directory node. */
	onFileMove: (srcPaths: readonly string[], destDir: string) => void;
	onExternalDrop: (files: readonly File[], destDir: string) => void;
	onNativeDragStart: (paths: readonly string[]) => void;
}

function pathDirname(path: string): string {
	const slash = path.lastIndexOf("/");
	const backslash = path.lastIndexOf("\\");
	const idx = Math.max(slash, backslash);
	if (idx < 0) return "";
	if (idx === 0) return path[0] ?? "";
	if (idx === 2 && /^[A-Za-z]:[\\/]/.test(path)) return path.slice(0, 3);
	return path.slice(0, idx);
}

function isSubPath(path: string, parent: string): boolean {
	const normalize = (v: string): string => v.replace(/\\/g, "/").replace(/\/+$/, "");
	const p = normalize(path);
	const base = normalize(parent);
	if (!base) return false;
	return p === base || p.startsWith(`${base}/`);
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

/**
 * Single file-tree row: chevron, icon, name / rename input, drag-drop.
 */
export function FileTreeNodeView({
	entry,
	depth,
	isExpanded,
	isLoading,
	isSelected,
	isFocused = false,
	isRenaming,
	decoration,
	dragPaths,
	onToggleDir,
	onSelectEntry,
	onContextMenu,
	onRenameSubmit,
	onRenameCancel,
	onFileMove,
	onExternalDrop,
	onNativeDragStart,
}: FileTreeNodeViewProps): JSX.Element {
	const [dragOver, setDragOver] = useState(false);
	const [renameValue, setRenameValue] = useState(entry.name);
	const inputRef = useRef<HTMLInputElement>(null);
	const icon = getFileIcon(entry.name, entry.isDirectory, isExpanded);

	useEffect(() => {
		if (isRenaming && inputRef.current) {
			inputRef.current.focus();
			const dotIdx = entry.name.lastIndexOf(".");
			const end = entry.isDirectory || dotIdx <= 0 ? entry.name.length : dotIdx;
			inputRef.current.setSelectionRange(0, end);
			setRenameValue(entry.name);
		}
	}, [isRenaming, entry.name, entry.isDirectory]);

	function handleClick(e: React.MouseEvent) {
		const toggle = e.ctrlKey || e.metaKey;
		const range = e.shiftKey && !toggle;
		const activate = !toggle && !range;
		onSelectEntry(entry, { toggle, range, activate });
		if (activate && entry.isDirectory) {
			onToggleDir(entry.path);
		}
	}

	function handleContextMenu(e: React.MouseEvent) {
		e.preventDefault();
		e.stopPropagation();
		onContextMenu(entry, e.clientX, e.clientY);
	}

	function handleRenameSubmit() {
		const trimmed = renameValue.trim();
		if (trimmed && trimmed !== entry.name) {
			onRenameSubmit(entry.path, trimmed);
		} else {
			onRenameCancel();
		}
	}

	function handleRenameKeyDown(e: React.KeyboardEvent) {
		if (e.key === "Enter") {
			e.preventDefault();
			handleRenameSubmit();
		} else if (e.key === "Escape") {
			onRenameCancel();
		}
	}

	function handleDragStart(e: React.DragEvent) {
		const paths = dragPaths && dragPaths.length > 0 ? [...dragPaths] : [entry.path];
		// Electron native drag cancels the HTML drag; in-window drops arrive as Files.
		beginNativeFileDrag(e, paths, onNativeDragStart);
	}

	function handleDragOver(e: React.DragEvent) {
		if (!entry.isDirectory) return;
		const types = Array.from(e.dataTransfer.types);
		const internal = types.includes(DRAG_MIME);
		if (!internal && !types.includes("Files")) return;
		e.preventDefault();
		e.stopPropagation();
		e.dataTransfer.dropEffect = internal ? "move" : "copy";
		setDragOver(true);
	}

	function handleDragLeave(e: React.DragEvent) {
		// Icon / label children fire leave when the pointer crosses them.
		if (!isDragLeavingElement(e)) return;
		setDragOver(false);
	}

	function handleDrop(e: React.DragEvent) {
		setDragOver(false);
		if (!entry.isDirectory) return;
		const raw = e.dataTransfer.getData(DRAG_MIME);
		e.preventDefault();
		e.stopPropagation();
		if (raw) {
			const srcPaths = parseInternalDragPaths(raw);
			const valid = srcPaths.filter((srcPath) => {
				if (isSubPath(entry.path, srcPath)) return false;
				const srcParent = pathDirname(srcPath);
				return srcParent !== entry.path;
			});
			if (valid.length > 0) onFileMove(valid, entry.path);
			return;
		}
		const files = Array.from(e.dataTransfer.files);
		if (files.length > 0) onExternalDrop(files, entry.path);
	}

	return (
		<div
			role="treeitem"
			aria-selected={isSelected}
			data-file-path={entry.path}
			tabIndex={isFocused || isSelected ? 0 : -1}
			draggable={!isRenaming}
			onClick={handleClick}
			onContextMenu={handleContextMenu}
			onDragStart={handleDragStart}
			onDragOver={handleDragOver}
			onDragLeave={handleDragLeave}
			onDrop={handleDrop}
			onKeyDown={(e) => {
				if (e.key === "Enter") {
					e.preventDefault();
					onSelectEntry(entry, { toggle: false, range: false, activate: true });
					if (entry.isDirectory) onToggleDir(entry.path);
				}
			}}
			className={cn(
				"flex items-center gap-1.5 rounded-md px-1.5 py-[3px] text-[12px] cursor-default select-none transition-colors",
				isSelected && !isRenaming ? "bg-accent text-foreground" : "text-foreground hover:bg-accent/50",
				isFocused && !isRenaming ? "ring-1 ring-inset ring-primary/40" : null,
				dragOver && FILE_TREE_NODE_DROP_CLASS,
			)}
			style={{ paddingLeft: `${depth * 16 + 6}px` }}
			title={decoration?.tooltip}
		>
			{entry.isDirectory ? (
				<span
					className={cn(
						"h-3 w-3 shrink-0 transition-transform",
						isLoading
							? "icon-[solar--refresh-linear] animate-spin text-muted-foreground"
							: isExpanded
								? "icon-[solar--alt-arrow-down-linear]"
								: "icon-[solar--alt-arrow-right-linear]",
					)}
				/>
			) : (
				<span className="h-3 w-3 shrink-0" />
			)}

			{decoration?.icon ? (
				<span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center">{decoration.icon}</span>
			) : (
				<span
					className={cn(
						icon,
						"h-3.5 w-3.5 shrink-0",
						entry.isDirectory ? "text-primary" : "text-muted-foreground",
					)}
				/>
			)}

			{isRenaming ? (
				<input
					ref={inputRef}
					type="text"
					value={renameValue}
					onChange={(e) => setRenameValue(e.target.value)}
					onBlur={handleRenameSubmit}
					onKeyDown={handleRenameKeyDown}
					className="min-w-0 flex-1 rounded border border-primary bg-background px-1 py-0 text-[12px] text-foreground outline-none"
					onClick={(e) => e.stopPropagation()}
				/>
			) : (
				<>
					<span className="min-w-0 flex-1 truncate">{entry.name}</span>
					{decoration?.badge ? (
						<span className="max-w-8 shrink-0 truncate rounded-full bg-accent px-1.5 text-[10px] text-muted-foreground">
							{decoration.badge}
						</span>
					) : null}
				</>
			)}
		</div>
	);
}
