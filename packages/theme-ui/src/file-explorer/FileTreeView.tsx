import { useState, type JSX } from "react";
import { FileTreeNodeView } from "./FileTreeNodeView";
import type { FileExplorerEntry, FileExplorerNodeDecoration } from "./types";

export interface FileTreeViewProps {
	rootDir: string;
	/** dir path → children */
	cache: ReadonlyMap<string, readonly FileExplorerEntry[]>;
	expandedDirs: ReadonlySet<string>;
	loadingDirs: ReadonlySet<string>;
	selectedPath: string | null;
	renamingPath: string | null;
	emptyLabel: string;
	getDecoration?: (entry: FileExplorerEntry) => FileExplorerNodeDecoration | null;
	onToggleDir: (path: string) => void;
	onSelectFile: (entry: FileExplorerEntry) => void;
	onContextMenu: (entry: FileExplorerEntry, x: number, y: number) => void;
	onRenameSubmit: (oldPath: string, newName: string) => void;
	onRenameCancel: () => void;
	onFileMove: (srcPath: string, destDir: string) => void;
	onExternalDrop: (files: readonly File[], destDir: string) => void;
	onNativeDragStart: (paths: readonly string[]) => void;
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

/**
 * Flattened file tree. Host owns cache / expand / rename path atoms.
 */
export function FileTreeView({
	rootDir,
	cache,
	expandedDirs,
	loadingDirs,
	selectedPath,
	renamingPath,
	emptyLabel,
	getDecoration,
	onToggleDir,
	onSelectFile,
	onContextMenu,
	onRenameSubmit,
	onRenameCancel,
	onFileMove,
	onExternalDrop,
	onNativeDragStart,
}: FileTreeViewProps): JSX.Element {
	const [rootDragOver, setRootDragOver] = useState(false);
	const flatList = buildFlatList(rootDir, cache, expandedDirs);

	function handleRootDragOver(event: React.DragEvent): void {
		const types = Array.from(event.dataTransfer.types);
		const internal = types.includes("application/vetta-path");
		if (!internal && !types.includes("Files")) return;
		event.preventDefault();
		event.dataTransfer.dropEffect = internal ? "move" : "copy";
		setRootDragOver(true);
	}

	function handleRootDrop(event: React.DragEvent): void {
		setRootDragOver(false);
		event.preventDefault();
		const sourcePath = event.dataTransfer.getData("application/vetta-path");
		if (sourcePath) {
			onFileMove(sourcePath, rootDir);
			return;
		}
		const files = Array.from(event.dataTransfer.files);
		if (files.length > 0) onExternalDrop(files, rootDir);
	}

	if (flatList.length === 0 && !loadingDirs.has(rootDir)) {
		return (
			<div
				onDragOver={handleRootDragOver}
				onDragLeave={() => setRootDragOver(false)}
				onDrop={handleRootDrop}
				className={`flex min-h-full items-center justify-center px-4 py-6 text-center text-[11px] text-muted-foreground ${rootDragOver ? "bg-primary/10 ring-1 ring-inset ring-primary/40" : ""}`}
			>
				{emptyLabel}
			</div>
		);
	}

	return (
		<div
			role="tree"
			onDragOver={handleRootDragOver}
			onDragLeave={() => setRootDragOver(false)}
			onDrop={handleRootDrop}
			className={`min-h-full py-0.5 ${rootDragOver ? "bg-primary/10 ring-1 ring-inset ring-primary/40" : ""}`}
		>
			{flatList.map((node) => (
				<FileTreeNodeView
					key={node.entry.path}
					entry={node.entry}
					depth={node.depth}
					isExpanded={expandedDirs.has(node.entry.path)}
					isLoading={loadingDirs.has(node.entry.path)}
					isSelected={selectedPath === node.entry.path}
					isRenaming={renamingPath === node.entry.path}
					decoration={getDecoration?.(node.entry)}
					onToggleDir={onToggleDir}
					onSelectFile={onSelectFile}
					onContextMenu={onContextMenu}
					onRenameSubmit={onRenameSubmit}
					onRenameCancel={onRenameCancel}
					onFileMove={onFileMove}
					onExternalDrop={onExternalDrop}
					onNativeDragStart={onNativeDragStart}
				/>
			))}
		</div>
	);
}
