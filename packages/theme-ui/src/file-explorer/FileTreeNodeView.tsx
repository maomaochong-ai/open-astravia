import { cn } from "@vetta/ui";
import { useEffect, useRef, useState, type JSX } from "react";
import { getFileIcon } from "./fileIcons";
import type { FileExplorerEntry } from "./types";

const DRAG_MIME = "application/vetta-path";

export interface FileTreeNodeViewProps {
	entry: FileExplorerEntry;
	depth: number;
	isExpanded: boolean;
	isLoading: boolean;
	isSelected: boolean;
	isRenaming: boolean;
	onToggleDir: (path: string) => void;
	onSelectFile: (entry: FileExplorerEntry) => void;
	onContextMenu: (entry: FileExplorerEntry, x: number, y: number) => void;
	onRenameSubmit: (oldPath: string, newName: string) => void;
	onRenameCancel: () => void;
	/** Called when a path is dropped onto this directory node. */
	onFileMove: (srcPath: string, destDir: string) => void;
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

/**
 * Single file-tree row: chevron, icon, name / rename input, drag-drop.
 */
export function FileTreeNodeView({
	entry,
	depth,
	isExpanded,
	isLoading,
	isSelected,
	isRenaming,
	onToggleDir,
	onSelectFile,
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

	function handleClick() {
		if (entry.isDirectory) {
			onToggleDir(entry.path);
		} else {
			onSelectFile(entry);
		}
	}

	function handleContextMenu(e: React.MouseEvent) {
		e.preventDefault();
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
		e.dataTransfer.setData(DRAG_MIME, entry.path);
		e.dataTransfer.setData(
			"application/vetta-path-meta",
			JSON.stringify({ isDirectory: entry.isDirectory, name: entry.name }),
		);
		e.dataTransfer.effectAllowed = "copyMove";
		onNativeDragStart([entry.path]);
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

	function handleDragLeave() {
		setDragOver(false);
	}

	function handleDrop(e: React.DragEvent) {
		setDragOver(false);
		if (!entry.isDirectory) return;
		const srcPath = e.dataTransfer.getData(DRAG_MIME);
		e.preventDefault();
		e.stopPropagation();
		if (srcPath) {
			if (isSubPath(entry.path, srcPath)) return;
			const srcParent = pathDirname(srcPath);
			if (srcParent === entry.path) return;
			onFileMove(srcPath, entry.path);
			return;
		}
		const files = Array.from(e.dataTransfer.files);
		if (files.length > 0) onExternalDrop(files, entry.path);
	}

	return (
		<div
			role="treeitem"
			tabIndex={0}
			draggable={!isRenaming}
			onClick={handleClick}
			onContextMenu={handleContextMenu}
			onDragStart={handleDragStart}
			onDragOver={handleDragOver}
			onDragLeave={handleDragLeave}
			onDrop={handleDrop}
			onKeyDown={(e) => {
				if (e.key === "Enter") handleClick();
			}}
			className={cn(
				"flex items-center gap-1.5 rounded-md px-1.5 py-[3px] text-[12px] cursor-default select-none transition-colors",
				isSelected && !isRenaming ? "bg-accent text-foreground" : "text-foreground hover:bg-accent/50",
				dragOver && "bg-primary/10 ring-1 ring-inset ring-primary/40",
			)}
			style={{ paddingLeft: `${depth * 16 + 6}px` }}
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

			<span
				className={cn(
					icon,
					"h-3.5 w-3.5 shrink-0",
					entry.isDirectory ? "text-primary" : "text-muted-foreground",
				)}
			/>

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
				<span className="min-w-0 flex-1 truncate">{entry.name}</span>
			)}
		</div>
	);
}
