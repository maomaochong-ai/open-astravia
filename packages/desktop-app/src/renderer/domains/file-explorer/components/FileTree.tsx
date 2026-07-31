import type { FsEntry } from "@shared/store/atoms";
import type { FileExplorerCreatingEntry } from "@vetta/theme-ui/file-explorer";
import { FileTreeView } from "@vetta/theme-ui/file-explorer";
import { useFileTreeViewModel } from "../hooks/useFileTreeViewModel";

interface FileTreeProps {
	rootDir: string;
	cache: Map<string, FsEntry[]>;
	expandedDirs: Set<string>;
	loadingDirs: Set<string>;
	selectedPath: string | null;
	creatingEntry: FileExplorerCreatingEntry | null;
	onToggleDir: (path: string) => void;
	onSelectFile: (entry: FsEntry) => void;
	onRename: (oldPath: string, newName: string) => Promise<void>;
	onFileMove: (srcPath: string, destDir: string) => void;
	onExternalDrop: (files: readonly File[], destDir: string) => void;
	onNativeDragStart: (paths: readonly string[]) => void;
	onContextMenu: (entry: FsEntry, x: number, y: number) => void;
	onRootContextMenu: (x: number, y: number) => void;
	onCreateSubmit: (name: string) => void;
	onCreateCancel: () => void;
}

export function FileTree(props: FileTreeProps): JSX.Element {
	const model = useFileTreeViewModel(props);
	return <FileTreeView {...model} />;
}
