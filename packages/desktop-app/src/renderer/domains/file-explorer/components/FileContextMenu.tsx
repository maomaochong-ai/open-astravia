import type { FileExplorerEntryKind } from "@preload/fs-types";
import type { FsEntry } from "@shared/store/atoms";
import { FileContextMenuView } from "@vetta/theme-ui/file-explorer";
import { useFileContextMenuModel } from "../hooks/useFileContextMenuModel";

interface FileContextMenuProps {
	x: number;
	y: number;
	entry: FsEntry;
	isRoot?: boolean;
	targetEntries: readonly FsEntry[];
	canPaste: boolean;
	onClose: () => void;
	onDelete: (entries: readonly FsEntry[]) => void;
	onCreate: (kind: FileExplorerEntryKind, parentDirectory: string) => void;
	onCopy: (entries: readonly FsEntry[]) => void;
	onPaste: () => void;
	onCopyPath: (entries: readonly FsEntry[]) => void;
}

export function FileContextMenu({
	x,
	y,
	entry,
	isRoot = false,
	targetEntries,
	canPaste,
	onClose,
	onDelete,
	onCreate,
	onCopy,
	onPaste,
	onCopyPath,
}: FileContextMenuProps): JSX.Element {
	const model = useFileContextMenuModel({
		entry,
		isRoot,
		targetEntries,
		canPaste,
		onClose,
		onDelete,
		onCreate,
		onCopy,
		onPaste,
		onCopyPath,
	});
	return <FileContextMenuView {...model} x={x} y={y} />;
}
