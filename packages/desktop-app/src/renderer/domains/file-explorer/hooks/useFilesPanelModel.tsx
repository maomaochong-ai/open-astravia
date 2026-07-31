import { Button } from "@shared/components/ui/button";
import type {
	FileTransferAction,
	FileTransferConflictPolicy,
	FileTransferPlan,
} from "@preload/fs-types";
import { useNarrowScreen } from "@shared/hooks/useNarrowScreen";
import { isSubPath, pathDirname } from "@shared/lib/utils";
import {
	activityPanelWidthAtom,
	ACTIVITY_PANEL_PREVIEW_MIN_WIDTH,
	confirmDialogAtom,
	defaultConversationCwdAtom,
	defaultImConversationCwdAtom,
	fileContextMenuAtom,
	fileTreeCacheAtom,
	filePreviewAtom,
	getProjectDisplayName,
	inlineFilePreviewAtom,
	inlineFilePreviewContextReadonlyAtom,
	openInlineFilePreviewAtom,
	type FilePreviewItem,
	type FsEntry,
	pluginFileExplorerToolbarActionsAtom,
} from "@shared/store/atoms";
import type { FilesPanelViewProps } from "@vetta/theme-ui/file-explorer";
import { getDefaultStore, useAtom, useAtomValue, useSetAtom } from "jotai";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
	bindPluginFileExplorerHost,
	emitPluginFileExplorerFilesChanged,
	emitPluginFileExplorerSelectionChanged,
} from "../../plugins/runtime/plugin-file-explorer-host";
import { PluginInlineI18nBoundary, usePluginTextResolver } from "../../plugins/runtime/plugin-i18n";
import { ConfirmDeleteDialog } from "../components/ConfirmDeleteDialog";
import { FileContextMenu } from "../components/FileContextMenu";
import { FileTransferDialog } from "../components/FileTransferDialog";
import { FileTree } from "../components/FileTree";
import { isProjectInternalDrop } from "../services/file-drop";
import { sortFileExplorerActions } from "../services/plugin-contributions";
import { useFileTree } from "./useFileTree";

export function useFilesPanelModel(cwd?: string | null): FilesPanelViewProps {
	const { t } = useTranslation("chat");
	const {
		cache,
		expandedDirs,
		loadingDirs,
		rootDir,
		toggleDir,
		renameEntry,
		deleteEntry,
		moveEntry,
		refreshDir,
		revealPath,
	} = useFileTree(cwd);

	const [contextMenu, setContextMenu] = useAtom(fileContextMenuAtom);
	const setPreview = useSetAtom(inlineFilePreviewAtom);
	const openInlinePreview = useSetAtom(openInlineFilePreviewAtom);
	const setGlobalPreview = useSetAtom(filePreviewAtom);
	const narrow = useNarrowScreen();
	const previewCtx = useAtomValue(inlineFilePreviewContextReadonlyAtom);
	const panelWidth = useAtomValue(activityPanelWidthAtom);
	const [deleteTarget, setDeleteTarget] = useState<FsEntry | null>(null);
	const [errorToast, setErrorToast] = useState<string | null>(null);
	const [transferPlan, setTransferPlan] = useState<FileTransferPlan | null>(null);
	const [transferBusy, setTransferBusy] = useState(false);
	const transferBusyRef = useRef(false);
	const [conflictPolicy, setConflictPolicy] = useState<FileTransferConflictPolicy>("keep-both");
	const defaultCwd = useAtomValue(defaultConversationCwdAtom);
	const imCwd = useAtomValue(defaultImConversationCwdAtom);
	const setConfirm = useSetAtom(confirmDialogAtom);
	const pluginToolbarActions = useAtomValue(pluginFileExplorerToolbarActionsAtom);
	const resolvePluginText = usePluginTextResolver();
	const [selectedEntry, setSelectedEntry] = useState<FsEntry | null>(null);

	const clearArtifactsScope: "conversation" | "claw" | null =
		rootDir && defaultCwd && rootDir === defaultCwd
			? "conversation"
			: rootDir && imCwd && rootDir === imCwd
				? "claw"
				: null;

	const handleClearArtifacts = useCallback(() => {
		if (!clearArtifactsScope || !rootDir) return;
		const label = clearArtifactsScope === "claw" ? "Claw" : t("fileExplorer.conversationLabel");
		setConfirm({
			title: t("fileExplorer.clearArtifactsTitle"),
			message: t("fileExplorer.clearArtifactsMessage", { label }),
			confirmLabel: t("fileExplorer.clearArtifactsConfirm"),
			variant: "danger",
			onConfirm: async () => {
				try {
					await window.vetta.session.clearDefaultArtifacts(clearArtifactsScope);
				} catch (err: unknown) {
					setErrorToast(err instanceof Error ? err.message : t("fileExplorer.clearArtifactsFailed"));
					return;
				}
				await refreshDir(rootDir);
			},
		});
	}, [clearArtifactsScope, rootDir, setConfirm, refreshDir, t]);

	const handleSelectFile = useCallback(
		(entry: FsEntry) => {
			setSelectedEntry(entry);
			emitPluginFileExplorerSelectionChanged([entry]);
			const dir = pathDirname(entry.path);
			let siblings: FsEntry[] = (cache.get(dir) ?? []).filter((e) => !e.isDirectory);

			if (siblings.length === 0) {
				for (const entries of cache.values()) {
					if (entries.some((e) => e.path === entry.path)) {
						siblings = entries.filter((e) => !e.isDirectory);
						break;
					}
				}
			}

			if (siblings.length === 0) {
				siblings = [entry];
			}

			const items: FilePreviewItem[] = siblings.map((e) => ({
				name: e.name,
				path: e.path,
				size: e.size,
			}));
			const idx = items.findIndex((it) => it.path === entry.path);
			const ctx = { items, index: idx >= 0 ? idx : 0 };
			if (narrow) {
				setGlobalPreview(ctx);
			} else {
				openInlinePreview(ctx);
			}
		},
		[cache, narrow, openInlinePreview, setGlobalPreview],
	);

	const selectedPath = selectedEntry?.path ?? previewCtx?.items[previewCtx.index]?.path ?? null;

	useEffect(() => {
		setSelectedEntry(null);
		emitPluginFileExplorerSelectionChanged([]);
	}, [rootDir]);

	useEffect(() => {
		const handle = bindPluginFileExplorerHost({
			getWorkspaceRoot: () =>
				rootDir ? { name: getProjectDisplayName(rootDir, defaultCwd), path: rootDir } : null,
			getSelection: () => (selectedEntry ? [selectedEntry] : []),
			reveal: async (path, options) => {
				if (!rootDir) throw new Error("File explorer has no active workspace");
				await revealPath(path);
				const entries = [...getDefaultStore().get(fileTreeCacheAtom).values()].flat();
				const entry = entries.find((candidate) => candidate.path === path);
				if (!entry) throw new Error(`Path is not visible in the active workspace: ${path}`);
				if (options?.select !== false) {
					setSelectedEntry(entry);
					emitPluginFileExplorerSelectionChanged([entry]);
				}
				if (options?.focus) {
					requestAnimationFrame(() => {
						const rows = document.querySelectorAll<HTMLElement>("[data-file-path]");
						for (const row of rows) {
							if (row.dataset.filePath !== path) continue;
							row.focus();
							break;
						}
					});
				}
			},
			refresh: async (path) => {
				const target = path ?? rootDir;
				if (!target) throw new Error("File explorer has no active workspace");
				if (!rootDir || !isSubPath(target, rootDir)) {
					throw new Error(`Path is outside the active workspace: ${target}`);
				}
				await refreshDir(target);
			},
		});
		return () => handle.dispose();
	}, [defaultCwd, refreshDir, revealPath, rootDir, selectedEntry]);

	useEffect(() => {
		if (narrow || previewCtx != null || !rootDir) return;
		if (panelWidth < ACTIVITY_PANEL_PREVIEW_MIN_WIDTH) return;
		const files = (cache.get(rootDir) ?? []).filter((e) => !e.isDirectory);
		if (files.length === 0) return;
		const items: FilePreviewItem[] = files.map((e) => ({ name: e.name, path: e.path, size: e.size }));
		setPreview({ items, index: 0 });
	}, [narrow, previewCtx, rootDir, panelWidth, cache, setPreview]);

	useEffect(() => {
		function handleMove(e: Event) {
			const { srcPath, destDir } = (e as CustomEvent).detail as { srcPath: string; destDir: string };
			void moveEntry(srcPath, destDir).catch((err: unknown) => {
				setErrorToast(err instanceof Error ? err.message : t("fileExplorer.moveFailed"));
			});
		}
		window.addEventListener("vetta:file-move", handleMove);
		return () => window.removeEventListener("vetta:file-move", handleMove);
	}, [moveEntry, t]);

	useEffect(() => {
		if (!errorToast) return;
		const timer = setTimeout(() => setErrorToast(null), 3000);
		return () => clearTimeout(timer);
	}, [errorToast]);

	const handleDelete = useCallback(async () => {
		if (!deleteTarget) return;
		try {
			await deleteEntry(deleteTarget.path);
		} catch (err: unknown) {
			setErrorToast(err instanceof Error ? err.message : t("fileExplorer.deleteFailed"));
		}
		setDeleteTarget(null);
	}, [deleteTarget, deleteEntry, t]);

	const onFileMove = useCallback(
		(srcPath: string, destDir: string) => {
			void moveEntry(srcPath, destDir).catch((err: unknown) => {
				setErrorToast(err instanceof Error ? err.message : t("fileExplorer.moveFailed"));
			});
		},
		[moveEntry, t],
	);

	const onExternalDrop = useCallback(
		(files: readonly File[], destinationDirectory: string) => {
			if (!rootDir || files.length === 0) return;
			const paths = files.map((file) => window.vetta.fs.pathForFile(file)).filter(Boolean);
			if (isProjectInternalDrop(paths, rootDir)) {
				for (const path of paths) onFileMove(path, destinationDirectory);
				return;
			}
			void window.vetta.fs
				.prepareDrop(files, destinationDirectory)
				.then((plan) => {
					setConflictPolicy("keep-both");
					setTransferPlan(plan);
				})
				.catch((error: unknown) => {
					console.warn("[file-explorer] prepare drop failed", error);
					setErrorToast(t("fileExplorer.transfer.prepareFailed"));
				});
		},
		[onFileMove, rootDir, t],
	);

	const onNativeDragStart = useCallback((paths: readonly string[]) => {
		window.vetta.fs.startDrag(paths);
	}, []);

	const cancelTransfer = useCallback(() => {
		if (!transferPlan || transferBusyRef.current) return;
		void window.vetta.fs.cancelDrop(transferPlan.id);
		setTransferPlan(null);
	}, [transferPlan]);

	useEffect(() => {
		return () => {
			if (transferPlan) void window.vetta.fs.cancelDrop(transferPlan.id);
		};
	}, [transferPlan]);

	const commitTransfer = useCallback(
		async (action: FileTransferAction) => {
			if (!transferPlan || transferBusyRef.current) return;
			transferBusyRef.current = true;
			setTransferBusy(true);
			try {
				const result = await window.vetta.fs.commitDrop(transferPlan.id, action, conflictPolicy);
				const failures = result.items.filter((item) => item.status === "failed");
				if (failures.length > 0) {
					setErrorToast(t("fileExplorer.transfer.failedCount", { count: failures.length }));
				}
				await refreshDir(transferPlan.destinationDirectory);
				emitPluginFileExplorerFilesChanged([{ type: "changed", path: transferPlan.destinationDirectory }]);
				setTransferPlan(null);
			} catch (error: unknown) {
				console.warn("[file-explorer] commit drop failed", error);
				setErrorToast(t("fileExplorer.transfer.commitFailed"));
				setTransferPlan(null);
			} finally {
				transferBusyRef.current = false;
				setTransferBusy(false);
			}
		},
		[conflictPolicy, refreshDir, t, transferPlan],
	);

	const onContextMenu = useCallback(
		(entry: FsEntry, x: number, y: number) => {
			setSelectedEntry(entry);
			emitPluginFileExplorerSelectionChanged([entry]);
			setContextMenu({ x, y, entry });
		},
		[setContextMenu],
	);

	if (!rootDir) {
		return {
			rootDir: null,
			labels: {
				selectProject: t("fileExplorer.selectProject"),
				headerTitle: "",
			},
			refreshButton: null,
			loadingRoot: false,
			tree: null,
			contextMenu: null,
			deleteDialog: null,
			transferDialog: null,
			errorToast,
		};
	}

	const projectName = getProjectDisplayName(rootDir, defaultCwd);
	const isHashedSubCwd = (() => {
		const root =
			defaultCwd && rootDir.startsWith(`${defaultCwd}/`)
				? defaultCwd
				: imCwd && rootDir.startsWith(`${imCwd}/`)
					? imCwd
					: null;
		if (!root) return false;
		const rest = rootDir.slice(root.length + 1);
		return rest.length > 0 && !rest.includes("/");
	})();

	const clearArtifactsButton: ReactNode = clearArtifactsScope ? (
		<Button
			variant="ghost"
			size="icon-xs"
			title={t("fileExplorer.clearArtifacts")}
			onClick={handleClearArtifacts}
		>
			<span className="icon-[mdi--broom] h-3.5 w-3.5" />
		</Button>
	) : undefined;

	const refreshButton = (
		<Button
			variant="ghost"
			size="icon-xs"
			title={t("fileExplorer.refresh")}
			onClick={() => void refreshDir(rootDir)}
		>
			<span className="icon-[mdi--refresh] h-3.5 w-3.5" />
		</Button>
	);

	const workspaceRoot = { name: projectName, path: rootDir };
	const toolbarActions = sortFileExplorerActions(pluginToolbarActions).map((action) => (
		<Button
			key={action.actionId}
			variant="ghost"
			size="icon-xs"
			title={resolvePluginText(action.pluginId, action.label)}
			onClick={() => {
				void Promise.resolve(
					action.run({
						workspaceRoot: { ...workspaceRoot },
						selection: selectedEntry ? [{ ...selectedEntry }] : [],
					}),
				).catch((error: unknown) => {
					console.error(`Plugin ${action.pluginId} file explorer toolbar action failed`, error);
				});
			}}
		>
			<PluginInlineI18nBoundary pluginId={action.pluginId}>
				{action.icon ?? <span className="icon-[solar--magic-stick-3-linear] h-3.5 w-3.5" />}
			</PluginInlineI18nBoundary>
		</Button>
	));

	const tree = (
		<FileTree
			rootDir={rootDir}
			cache={cache}
			expandedDirs={expandedDirs}
			loadingDirs={loadingDirs}
			selectedPath={selectedPath}
			onToggleDir={toggleDir}
			onSelectFile={handleSelectFile}
			onRename={renameEntry}
			onFileMove={onFileMove}
			onExternalDrop={onExternalDrop}
			onNativeDragStart={onNativeDragStart}
			onContextMenu={onContextMenu}
		/>
	);

	const contextMenuNode = contextMenu ? (
		<FileContextMenu
			x={contextMenu.x}
			y={contextMenu.y}
			entry={contextMenu.entry}
			onClose={() => setContextMenu(null)}
			onDelete={(entry) => {
				setContextMenu(null);
				setDeleteTarget(entry);
			}}
		/>
	) : null;

	const deleteDialog = deleteTarget ? (
		<ConfirmDeleteDialog
			entry={deleteTarget}
			onConfirm={() => void handleDelete()}
			onCancel={() => setDeleteTarget(null)}
		/>
	) : null;

	const transferDialog = transferPlan ? (
		<FileTransferDialog
			plan={transferPlan}
			conflictPolicy={conflictPolicy}
			busy={transferBusy}
			onConflictPolicyChange={setConflictPolicy}
			onConfirm={(action) => void commitTransfer(action)}
			onCancel={cancelTransfer}
		/>
	) : null;

	return {
		rootDir,
		labels: {
			selectProject: t("fileExplorer.selectProject"),
			headerTitle: isHashedSubCwd ? t("fileExplorer.fileList") : projectName,
		},
		clearArtifactsButton,
		toolbarActions,
		refreshButton,
		loadingRoot: loadingDirs.has(rootDir) && !cache.has(rootDir),
		tree,
		contextMenu: contextMenuNode,
		deleteDialog,
		transferDialog,
		errorToast,
	};
}
