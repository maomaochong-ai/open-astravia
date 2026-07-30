import { type FsEntry, renamingPathAtom } from "@shared/store/atoms";
import type { FileTreeViewProps } from "@vetta/theme-ui/file-explorer";
import { useAtom } from "jotai";
import { useCallback } from "react";
import { useTranslation } from "react-i18next";

export function useFileTreeViewModel(input: {
	rootDir: string;
	cache: Map<string, FsEntry[]>;
	expandedDirs: Set<string>;
	loadingDirs: Set<string>;
	selectedPath: string | null;
	onToggleDir: (path: string) => void;
	onSelectFile: (entry: FsEntry) => void;
	onRename: (oldPath: string, newName: string) => Promise<void>;
	onFileMove: (srcPath: string, destDir: string) => void;
	onExternalDrop: (files: readonly File[], destDir: string) => void;
	onNativeDragStart: (paths: readonly string[]) => void;
	onContextMenu: (entry: FsEntry, x: number, y: number) => void;
}): FileTreeViewProps {
	const { t } = useTranslation("chat");
	const [renamingPath, setRenamingPath] = useAtom(renamingPathAtom);

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
		rootDir: input.rootDir,
		cache: input.cache,
		expandedDirs: input.expandedDirs,
		loadingDirs: input.loadingDirs,
		selectedPath: input.selectedPath,
		renamingPath,
		emptyLabel: t("fileExplorer.emptyFolder"),
		onToggleDir: input.onToggleDir,
		onSelectFile: input.onSelectFile,
		onContextMenu: input.onContextMenu,
		onRenameSubmit,
		onRenameCancel,
		onFileMove: input.onFileMove,
		onExternalDrop: input.onExternalDrop,
		onNativeDragStart: input.onNativeDragStart,
	};
}
