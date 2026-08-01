import type { FsEntry } from "@shared/store/atoms";
import type {
	FileExplorerCreatingEntry,
	FileExplorerDragEntry,
	FileExplorerSelectOptions,
} from "@vetta/theme-ui/file-explorer";
import { FileTreeView } from "@vetta/theme-ui/file-explorer";
import type { KeyboardEvent } from "react";
import { useFileTreeViewModel } from "../hooks/useFileTreeViewModel";

interface FileTreeProps {
	rootDir: string;
	cache: Map<string, FsEntry[]>;
	expandedDirs: Set<string>;
	loadingDirs: Set<string>;
	selectedPaths: ReadonlySet<string>;
	focusedPath: string | null;
	creatingEntry: FileExplorerCreatingEntry | null;
	onToggleDir: (path: string) => void;
	onSelectEntry: (entry: FsEntry, options: FileExplorerSelectOptions) => void;
	onBackgroundClick: () => void;
	onRename: (oldPath: string, newName: string) => Promise<void>;
	onFileMove: (srcPaths: readonly string[], destDir: string) => void;
	onExternalDrop: (files: readonly File[], destDir: string) => void;
	onNativeDragStart: (paths: readonly string[]) => void;
	onPrefetchNativeDragIcons?: (entries: readonly FileExplorerDragEntry[]) => void;
	onContextMenu: (entry: FsEntry, x: number, y: number) => void;
	onRootContextMenu: (x: number, y: number) => void;
	onCreateSubmit: (name: string) => void;
	onCreateCancel: () => void;
	onTreeKeyDown?: (event: KeyboardEvent<HTMLDivElement>) => void;
}

export function FileTree(props: FileTreeProps): JSX.Element {
	const model = useFileTreeViewModel(props);
	return <FileTreeView {...model} />;
}
