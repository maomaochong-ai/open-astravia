import { type FsEntry, pluginFileExplorerDecorationProvidersAtom, renamingPathAtom } from "@shared/store/atoms";
import type { FileExplorerCreatingEntry, FileTreeViewProps } from "@vetta/theme-ui/file-explorer";
import { useAtom, useAtomValue } from "jotai";
import { createElement, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { PluginInlineI18nBoundary, usePluginTextResolver } from "../../plugins/runtime/plugin-i18n";
import { resolveFileExplorerDecoration } from "../services/plugin-contributions";

export function useFileTreeViewModel(input: {
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
}): FileTreeViewProps {
	const { t } = useTranslation("chat");
	const [renamingPath, setRenamingPath] = useAtom(renamingPathAtom);
	const decorationProviders = useAtomValue(pluginFileExplorerDecorationProvidersAtom);
	const resolvePluginText = usePluginTextResolver();

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

	const getDecoration = useCallback(
		(entry: FsEntry) => {
			const resolved = resolveFileExplorerDecoration(entry, decorationProviders);
			if (!resolved) return null;
			const { decoration } = resolved;
			return {
				...decoration,
				tooltip: decoration.tooltip ? resolvePluginText(resolved.pluginId, decoration.tooltip) : undefined,
				icon: decoration.icon
					? createElement(PluginInlineI18nBoundary, { pluginId: resolved.pluginId }, decoration.icon)
					: undefined,
			};
		},
		[decorationProviders, resolvePluginText],
	);

	return {
		rootDir: input.rootDir,
		cache: input.cache,
		expandedDirs: input.expandedDirs,
		loadingDirs: input.loadingDirs,
		selectedPath: input.selectedPath,
		renamingPath,
		creatingEntry: input.creatingEntry,
		emptyLabel: t("fileExplorer.emptyFolder"),
		createInputLabel:
			input.creatingEntry?.kind === "directory"
				? t("fileExplorer.newFolderInputLabel")
				: t("fileExplorer.newFileInputLabel"),
		getDecoration,
		onToggleDir: input.onToggleDir,
		onSelectFile: input.onSelectFile,
		onContextMenu: input.onContextMenu,
		onRootContextMenu: input.onRootContextMenu,
		onRenameSubmit,
		onRenameCancel,
		onCreateSubmit: input.onCreateSubmit,
		onCreateCancel: input.onCreateCancel,
		onFileMove: input.onFileMove,
		onExternalDrop: input.onExternalDrop,
		onNativeDragStart: input.onNativeDragStart,
	};
}
