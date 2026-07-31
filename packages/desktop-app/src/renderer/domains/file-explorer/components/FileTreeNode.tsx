import type { FsEntry } from "@shared/store/atoms";
import { FileTreeNodeView } from "@vetta/theme-ui/file-explorer";
import { useFileTreeNodeModel } from "../hooks/useFileTreeNodeModel";

interface FileTreeNodeProps {
	entry: FsEntry;
	depth: number;
	isExpanded: boolean;
	isLoading: boolean;
	isSelected: boolean;
	onToggleDir: (path: string) => void;
	onSelectFile: (entry: FsEntry) => void;
	onRename: (oldPath: string, newName: string) => Promise<void>;
	onFileMove: (srcPath: string, destDir: string) => void;
	onExternalDrop: (files: readonly File[], destDir: string) => void;
	onNativeDragStart: (paths: readonly string[]) => void;
}

export function FileTreeNode(props: FileTreeNodeProps): JSX.Element {
	const model = useFileTreeNodeModel(props);
	return <FileTreeNodeView {...model} />;
}
