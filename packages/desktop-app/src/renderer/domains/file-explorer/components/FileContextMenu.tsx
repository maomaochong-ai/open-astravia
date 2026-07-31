import type { FsEntry } from "@shared/store/atoms";
import type { FileExplorerEntryKind } from "@preload/fs-types";
import { FileContextMenuView } from "@vetta/theme-ui/file-explorer";
import { useFileContextMenuModel } from "../hooks/useFileContextMenuModel";

interface FileContextMenuProps {
	x: number;
	y: number;
	entry: FsEntry;
	isRoot?: boolean;
	onClose: () => void;
	onDelete: (entry: FsEntry) => void;
	onCreate: (kind: FileExplorerEntryKind, parentDirectory: string) => void;
}

export function FileContextMenu({
	x,
	y,
	entry,
	isRoot = false,
	onClose,
	onDelete,
	onCreate,
}: FileContextMenuProps): JSX.Element {
	const model = useFileContextMenuModel(entry, isRoot, onClose, onDelete, onCreate);
	return <FileContextMenuView {...model} x={x} y={y} />;
}
