import type { FileExplorerEntryKind } from "@preload/fs-types";
import { isMac } from "@shared/lib/platform";
import { pathDirname } from "@shared/lib/utils";
import { type FsEntry, pluginFileExplorerContextMenuActionsAtom, renamingPathAtom } from "@shared/store/atoms";
import type { FileContextMenuViewProps } from "@vetta/theme-ui/file-explorer";
import { useAtomValue, useSetAtom } from "jotai";
import { createElement, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { getPluginFileExplorerWorkspaceRoots } from "../../plugins/runtime/plugin-file-explorer-host";
import { PluginInlineI18nBoundary, usePluginTextResolver } from "../../plugins/runtime/plugin-i18n";
import { matchesFileExplorerWhen, sortFileExplorerActions } from "../services/plugin-contributions";

export function useFileContextMenuModel(
	entry: FsEntry,
	isRoot: boolean,
	onClose: () => void,
	onDelete: (entry: FsEntry) => void,
	onCreate: (kind: FileExplorerEntryKind, parentDirectory: string) => void,
): FileContextMenuViewProps {
	const { t } = useTranslation("chat");
	const setRenamingPath = useSetAtom(renamingPathAtom);
	const pluginActions = useAtomValue(pluginFileExplorerContextMenuActionsAtom);
	const resolvePluginText = usePluginTextResolver();

	const onOpenInFolder = useCallback(() => {
		if (entry.isDirectory) {
			void window.vetta.shell.showInFolder(entry.path);
		} else {
			void window.vetta.shell.showItemInFolder(entry.path);
		}
		onClose();
	}, [entry, onClose]);

	const onCopyName = useCallback(() => {
		void navigator.clipboard.writeText(entry.name);
		onClose();
	}, [entry.name, onClose]);

	const onRename = useCallback(() => {
		setRenamingPath(entry.path);
		onClose();
	}, [entry.path, onClose, setRenamingPath]);

	const handleDelete = useCallback(() => {
		onDelete(entry);
	}, [entry, onDelete]);

	const handleCreate = useCallback(
		(kind: FileExplorerEntryKind) => {
			const parentDirectory = isRoot || entry.isDirectory ? entry.path : pathDirname(entry.path);
			onClose();
			onCreate(kind, parentDirectory);
		},
		[entry, isRoot, onClose, onCreate],
	);

	const resolvedPluginActions = useMemo(
		() =>
			isRoot
				? []
				: sortFileExplorerActions(pluginActions)
						.filter((action) => matchesFileExplorerWhen(entry, action.when))
						.map((action) => ({
							id: action.actionId,
							label: resolvePluginText(action.pluginId, action.label),
							icon: action.icon
								? createElement(PluginInlineI18nBoundary, { pluginId: action.pluginId }, action.icon)
								: undefined,
							onSelect: () => {
								onClose();
								void Promise.resolve(
									action.run({
										entry: { ...entry },
										workspaceRoot: getPluginFileExplorerWorkspaceRoots()[0] ?? null,
									}),
								).catch((error: unknown) => {
									console.error(`Plugin ${action.pluginId} file explorer action failed`, error);
								});
							},
						})),
		[entry, isRoot, onClose, pluginActions, resolvePluginText],
	);

	return {
		x: 0,
		y: 0,
		labels: {
			newFile: t("fileExplorer.newFile"),
			newFolder: t("fileExplorer.newFolder"),
			openInFolder: isMac ? t("fileExplorer.openInFinder") : t("fileExplorer.openInExplorer"),
			copyName: t("fileExplorer.copyName"),
			rename: t("fileExplorer.rename"),
			delete: t("fileExplorer.delete"),
		},
		onClose,
		onCreateFile: () => handleCreate("file"),
		onCreateFolder: () => handleCreate("directory"),
		onOpenInFolder,
		onCopyName,
		onRename,
		onDelete: handleDelete,
		showEntryActions: !isRoot,
		pluginActions: resolvedPluginActions,
	};
}
