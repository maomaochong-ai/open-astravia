import type { FsEntry } from "@shared/store/atoms";
import type { FileExplorerDragEntry, FileExplorerSelectOptions } from "@vetta/theme-ui/file-explorer";
import { FileTreeNodeView } from "@vetta/theme-ui/file-explorer";
import { useFileTreeNodeModel } from "../hooks/useFileTreeNodeModel";

interface FileTreeNodeProps {
	entry: FsEntry;
	depth: number;
	isExpanded: boolean;
	isLoading: boolean;
	isSelected: boolean;
	isFocused?: boolean;
	dragEntries?: readonly FileExplorerDragEntry[];
	onToggleDir: (path: string) => void;
	onSelectEntry: (entry: FsEntry, options: FileExplorerSelectOptions) => void;
	onRename: (oldPath: string, newName: string) => Promise<void>;
	onFileMove: (srcPaths: readonly string[], destDir: string) => void;
	onExternalDrop: (files: readonly File[], destDir: string) => void;
	onNativeDragStart: (paths: readonly string[]) => void;
	onPrefetchNativeDragIcons?: (entries: readonly FileExplorerDragEntry[]) => void;
}

export function FileTreeNode(props: FileTreeNodeProps): JSX.Element {
	const model = useFileTreeNodeModel(props);
	return <FileTreeNodeView {...model} />;
}
