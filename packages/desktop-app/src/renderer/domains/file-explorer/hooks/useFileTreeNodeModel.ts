import { type FsEntry, fileContextMenuAtom, renamingPathAtom } from "@shared/store/atoms";
import type { FileTreeNodeViewProps } from "@vetta/theme-ui/file-explorer";
import { useAtom } from "jotai";
import { useCallback } from "react";

export function useFileTreeNodeModel(input: {
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
		isRenaming: renamingPath === input.entry.path,
		onToggleDir: input.onToggleDir,
		onSelectFile: input.onSelectFile,
		onContextMenu,
		onRenameSubmit,
		onRenameCancel,
		onFileMove: input.onFileMove,
		onExternalDrop: input.onExternalDrop,
		onNativeDragStart: input.onNativeDragStart,
	};
}
