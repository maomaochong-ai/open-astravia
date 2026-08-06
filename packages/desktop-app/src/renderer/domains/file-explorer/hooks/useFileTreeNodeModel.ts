import { type FsEntry, fileContextMenuAtom, renamingPathAtom } from "@shared/store/atoms";
import type {
	FileExplorerDragEntry,
	FileExplorerSelectOptions,
	FileTreeNodeViewProps,
} from "@vetta/theme-ui/file-explorer";
import { useAtom } from "jotai";
import { useCallback } from "react";

export function useFileTreeNodeModel(input: {
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
}): FileTreeNodeViewProps {
	const [, setContextMenu] = useAtom(fileContextMenuAtom);
	const [renamingPath, setRenamingPath] = useAtom(renamingPathAtom);

	const onContextMenu = useCallback(
		(entry: FsEntry, x: number, y: number) => {
			setContextMenu({ x, y, entry });
		},
		[setContextMenu],
	);

	const onRenameSubmit = useCallback(
		(oldPath: string, newName: string) => {
			void input.onRename(oldPath, newName);
			setRenamingPath(null);
		},
		[input, setRenamingPath],
	);

	const onRenameCancel = useCallback(() => {
		setRenamingPath(null);
	}, [setRenamingPath]);

	return {
		entry: input.entry,
		depth: input.depth,
		isExpanded: input.isExpanded,
		isLoading: input.isLoading,
		isSelected: input.isSelected,
		isFocused: input.isFocused,
		isRenaming: renamingPath === input.entry.path,
		dragEntries: input.dragEntries,
		onToggleDir: input.onToggleDir,
		onSelectEntry: input.onSelectEntry,
		onContextMenu,
		onRenameSubmit,
		onRenameCancel,
		onFileMove: input.onFileMove,
		onExternalDrop: input.onExternalDrop,
		onNativeDragStart: input.onNativeDragStart,
		onPrefetchNativeDragIcons: input.onPrefetchNativeDragIcons,
	};
}
