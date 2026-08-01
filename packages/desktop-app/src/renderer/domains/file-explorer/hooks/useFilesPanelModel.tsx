import { Button } from "@shared/components/ui/button";
import {
	FILE_EXPLORER_ENTRY_EXISTS_ERROR,
	getFileExplorerEntryNameIssue,
	type FileExplorerEntryNameIssue,
} from "@/preload/file-explorer-entry-name";
import type {
	FileExplorerEntryKind,
	FileTransferAction,
	FileTransferConflictPolicy,
	FileTransferPlan,
} from "@preload/fs-types";
import { useNarrowScreen } from "@shared/hooks/useNarrowScreen";
import { isWindows } from "@shared/lib/platform";
import { isSubPath, pathBasename, pathDirname } from "@shared/lib/utils";
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
	renamingPathAtom,
} from "@shared/store/atoms";
import type {
	FileExplorerCreatingEntry,
	FileExplorerDragEntry,
	FileExplorerSelectOptions,
	FilesPanelViewProps,
} from "@vetta/theme-ui/file-explorer";
import { getDefaultStore, useAtom, useAtomValue, useSetAtom } from "jotai";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
	bindPluginFileExplorerHost,
	emitPluginFileExplorerFilesChanged,
} from "../../plugins/runtime/plugin-file-explorer-host";
import { PluginInlineI18nBoundary, usePluginTextResolver } from "../../plugins/runtime/plugin-i18n";
import { ConfirmDeleteDialog } from "../components/ConfirmDeleteDialog";
import { FileContextMenu } from "../components/FileContextMenu";
import { FileTransferDialog } from "../components/FileTransferDialog";
import { FileTree } from "../components/FileTree";
import { type FileExplorerClipboard, resolvePasteDirectory } from "../services/clipboard";
import { resolveCreateParentDirectory } from "../services/create-entry";
import { isProjectInternalDrop } from "../services/file-drop";
import { sortFileExplorerActions } from "../services/plugin-contributions";
import { cacheAppFileDragIcons } from "../services/rasterize-app-file-icon";
import { useFileExplorerSelection } from "./useFileExplorerSelection";
import { useFileTree } from "./useFileTree";

function isEditableEventTarget(target: EventTarget | null): boolean {
	if (!(target instanceof HTMLElement)) return false;
	const tag = target.tagName;
	return tag === "INPUT" || tag === "TEXTAREA" || target.isContentEditable;
}

export function useFilesPanelModel(cwd?: string | null): FilesPanelViewProps {
	const { t } = useTranslation("chat");
	const {
		cache,
		expandedDirs,
		loadingDirs,
		rootDir,
		toggleDir,
		expandDir,
		collapseAll,
		renameEntry,
		deleteEntry,
		moveEntry,
		refreshDir,
		revealPath,
	} = useFileTree(cwd);

	const selection = useFileExplorerSelection({ rootDir, cache, expandedDirs });

	const [contextMenu, setContextMenu] = useAtom(fileContextMenuAtom);
	const setPreview = useSetAtom(inlineFilePreviewAtom);
	const openInlinePreview = useSetAtom(openInlineFilePreviewAtom);
	const setGlobalPreview = useSetAtom(filePreviewAtom);
	const narrow = useNarrowScreen();
	const previewCtx = useAtomValue(inlineFilePreviewContextReadonlyAtom);
	const panelWidth = useAtomValue(activityPanelWidthAtom);
	const [deleteTargets, setDeleteTargets] = useState<FsEntry[] | null>(null);
	const [errorToast, setErrorToast] = useState<string | null>(null);
	const [transferPlan, setTransferPlan] = useState<FileTransferPlan | null>(null);
	const [transferBusy, setTransferBusy] = useState(false);
	const transferBusyRef = useRef(false);
	const [conflictPolicy, setConflictPolicy] = useState<FileTransferConflictPolicy>("keep-both");
	const [clipboard, setClipboard] = useState<FileExplorerClipboard | null>(null);
	const defaultCwd = useAtomValue(defaultConversationCwdAtom);
	const imCwd = useAtomValue(defaultImConversationCwdAtom);
	const setConfirm = useSetAtom(confirmDialogAtom);
	const pluginToolbarActions = useAtomValue(pluginFileExplorerToolbarActionsAtom);
	const resolvePluginText = usePluginTextResolver();
	const [creatingEntry, setCreatingEntry] = useState<FileExplorerCreatingEntry | null>(null);
	const setRenamingPath = useSetAtom(renamingPathAtom);
	const renamingPath = useAtomValue(renamingPathAtom);

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

	const openPreviewForEntry = useCallback(
		(entry: FsEntry) => {
			if (entry.isDirectory) return;
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

	const handleSelectEntry = useCallback(
		(entry: FsEntry, options: FileExplorerSelectOptions) => {
			selection.selectEntry(entry, options);
			if (options.activate && !entry.isDirectory) {
				openPreviewForEntry(entry);
			}
		},
		[openPreviewForEntry, selection],
	);

	const handleBackgroundClick = useCallback(() => {
		setContextMenu(null);
		selection.clear();
	}, [selection, setContextMenu]);

	useEffect(() => {
		setCreatingEntry(null);
		setContextMenu(null);
		setClipboard(null);
	}, [rootDir, setContextMenu]);

	const getCreateNameError = useCallback(
		(issue: FileExplorerEntryNameIssue): string => {
			switch (issue) {
				case "empty":
					return t("fileExplorer.invalidName.empty");
				case "dot-path":
					return t("fileExplorer.invalidName.dotPath");
				case "path-separator":
					return t("fileExplorer.invalidName.pathSeparator");
				case "invalid-character":
					return t("fileExplorer.invalidName.invalidCharacter");
				case "reserved-name":
					return t("fileExplorer.invalidName.reservedName");
				case "trailing-character":
					return t("fileExplorer.invalidName.trailingCharacter");
			}
		},
		[t],
	);

	const beginCreate = useCallback(
		(kind: FileExplorerEntryKind, parentDirectory?: string) => {
			if (!rootDir) return;
			const parent =
				parentDirectory ??
				resolveCreateParentDirectory(
					rootDir,
					selection.focusedEntry ?? selection.selectedEntries[selection.selectedEntries.length - 1] ?? null,
				);
			setContextMenu(null);
			setRenamingPath(null);
			if (parent !== rootDir) void expandDir(parent);
			setCreatingEntry({ parentPath: parent, kind, error: null, busy: false });
		},
		[expandDir, rootDir, selection.focusedEntry, selection.selectedEntries, setContextMenu, setRenamingPath],
	);

	const handleCreateSubmit = useCallback(
		(name: string) => {
			if (!creatingEntry) return;
			const issue = getFileExplorerEntryNameIssue(name, { windows: isWindows });
			if (issue) {
				setCreatingEntry((current) => (current ? { ...current, error: getCreateNameError(issue) } : current));
				return;
			}

			const pending = creatingEntry;
			setCreatingEntry({ ...pending, error: null, busy: true });
			void window.vetta.fs
				.createEntry(pending.parentPath, name, pending.kind)
				.then(async (entry) => {
					await refreshDir(pending.parentPath);
					emitPluginFileExplorerFilesChanged([{ type: "created", path: entry.path }]);
					selection.replaceWith(entry);
					setCreatingEntry(null);
				})
				.catch((error: unknown) => {
					const message = String(error).includes(FILE_EXPLORER_ENTRY_EXISTS_ERROR)
						? t("fileExplorer.createAlreadyExists")
						: t("fileExplorer.createFailed");
					setCreatingEntry((current) =>
						current?.parentPath === pending.parentPath && current.kind === pending.kind
							? { ...current, error: message, busy: false }
							: current,
					);
				});
		},
		[creatingEntry, getCreateNameError, refreshDir, selection, t],
	);

	useEffect(() => {
		const handle = bindPluginFileExplorerHost({
			getWorkspaceRoot: () =>
				rootDir ? { name: getProjectDisplayName(rootDir, defaultCwd), path: rootDir } : null,
			getSelection: () => selection.selectedEntries.map((entry) => ({ ...entry })),
			reveal: async (path, options) => {
				if (!rootDir) throw new Error("File explorer has no active workspace");
				await revealPath(path);
				const entries = [...getDefaultStore().get(fileTreeCacheAtom).values()].flat();
				const entry = entries.find((candidate) => candidate.path === path);
				if (!entry) throw new Error(`Path is not visible in the active workspace: ${path}`);
				if (options?.select !== false) {
					selection.replaceWith(entry);
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
	}, [defaultCwd, refreshDir, revealPath, rootDir, selection]);

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

	const handleDeleteConfirm = useCallback(async () => {
		if (!deleteTargets || deleteTargets.length === 0) return;
		const targets = [...deleteTargets];
		setDeleteTargets(null);
		const failures: string[] = [];
		for (const entry of targets) {
			try {
				await deleteEntry(entry.path);
			} catch (err: unknown) {
				failures.push(err instanceof Error ? err.message : t("fileExplorer.deleteFailed"));
			}
		}
		if (failures.length > 0) {
			setErrorToast(failures[0] ?? t("fileExplorer.deleteFailed"));
		}
		selection.clear();
		if (clipboard) {
			const remaining = clipboard.entries.filter((entry) => !targets.some((t) => t.path === entry.path));
			setClipboard(remaining.length > 0 ? { entries: remaining } : null);
		}
	}, [clipboard, deleteEntry, deleteTargets, selection, t]);

	const requestDelete = useCallback(
		(entries: readonly FsEntry[]) => {
			if (entries.length === 0) return;
			setContextMenu(null);
			setDeleteTargets([...entries]);
		},
		[setContextMenu],
	);

	const onFileMove = useCallback(
		(srcPaths: readonly string[], destDir: string) => {
			void (async () => {
				for (const srcPath of srcPaths) {
					try {
						await moveEntry(srcPath, destDir);
					} catch (err: unknown) {
						setErrorToast(err instanceof Error ? err.message : t("fileExplorer.moveFailed"));
						break;
					}
				}
			})();
		},
		[moveEntry, t],
	);

	const onExternalDrop = useCallback(
		(files: readonly File[], destinationDirectory: string) => {
			if (!rootDir || files.length === 0) return;
			const paths = files.map((file) => window.vetta.fs.pathForFile(file)).filter(Boolean);
			if (isProjectInternalDrop(paths, rootDir)) {
				onFileMove(paths, destinationDirectory);
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

	const onPrefetchNativeDragIcons = useCallback((entries: readonly FileExplorerDragEntry[]) => {
		if (entries.length === 0) return;
		void cacheAppFileDragIcons(entries);
	}, []);

	// Multi-select / keyboard selection: warm app type icons before the user starts dragging.
	useEffect(() => {
		const entries = selection.selectedEntries.map((entry) => ({
			path: entry.path,
			name: entry.name,
			isDirectory: entry.isDirectory,
		}));
		if (entries.length === 0) return;
		void cacheAppFileDragIcons(entries);
	}, [selection.selectedEntries]);

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

	const copyEntriesToClipboard = useCallback((entries: readonly FsEntry[]) => {
		if (entries.length === 0) return;
		setClipboard({ entries: entries.map((entry) => ({ ...entry })) });
	}, []);

	const copyPathsToSystemClipboard = useCallback((entries: readonly FsEntry[]) => {
		if (entries.length === 0) return;
		void navigator.clipboard.writeText(entries.map((entry) => entry.path).join("\n"));
	}, []);

	/** Copy-only paste. Optional destination override for root/background menu. */
	const beginPaste = useCallback(
		(destinationOverride?: string) => {
			if (!rootDir || !clipboard || clipboard.entries.length === 0) return;
			const destinationDirectory =
				destinationOverride ??
				resolvePasteDirectory(rootDir, selection.focusedEntry, selection.selectedEntries);
			const sourcePaths = clipboard.entries.map((entry) => entry.path);
			void window.vetta.fs
				.prepareTransfer(sourcePaths, destinationDirectory)
				.then(async (plan) => {
					transferBusyRef.current = true;
					setTransferBusy(true);
					try {
						// keep-both handles same-folder duplicates and name conflicts without a prompt.
						const result = await window.vetta.fs.commitDrop(plan.id, "copy", "keep-both");
						const failures = result.items.filter((item) => item.status === "failed");
						if (failures.length > 0) {
							setErrorToast(t("fileExplorer.transfer.failedCount", { count: failures.length }));
						}
						await refreshDir(destinationDirectory);
						emitPluginFileExplorerFilesChanged([{ type: "changed", path: destinationDirectory }]);
					} catch (error: unknown) {
						console.warn("[file-explorer] paste commit failed", error);
						setErrorToast(t("fileExplorer.transfer.commitFailed"));
						void window.vetta.fs.cancelDrop(plan.id);
					} finally {
						transferBusyRef.current = false;
						setTransferBusy(false);
					}
				})
				.catch((error: unknown) => {
					console.warn("[file-explorer] prepare paste failed", error);
					setErrorToast(t("fileExplorer.transfer.prepareFailed"));
				});
		},
		[clipboard, refreshDir, rootDir, selection.focusedEntry, selection.selectedEntries, t],
	);

	const onContextMenu = useCallback(
		(entry: FsEntry, x: number, y: number) => {
			selection.prepareContextTarget(entry);
			setContextMenu({ x, y, entry, isRoot: false });
		},
		[selection, setContextMenu],
	);

	const onRootContextMenu = useCallback(
		(x: number, y: number) => {
			if (!rootDir) return;
			// Background menu acts on the workspace root — clear multi-select first.
			selection.clear();
			setContextMenu({
				x,
				y,
				isRoot: true,
				entry: {
					name: pathBasename(rootDir),
					path: rootDir,
					isDirectory: true,
					size: 0,
					modifiedAt: 0,
				},
			});
		},
		[rootDir, selection, setContextMenu],
	);

	const handleTreeKeyDown = useCallback(
		(event: KeyboardEvent<HTMLDivElement>) => {
			if (isEditableEventTarget(event.target) || renamingPath || creatingEntry) return;
			const mod = event.ctrlKey || event.metaKey;
			const key = event.key.toLowerCase();

			if (event.key === "ArrowDown" || event.key === "ArrowUp") {
				event.preventDefault();
				const next = selection.moveFocus(event.key === "ArrowDown" ? 1 : -1, event.shiftKey);
				const entry = selection.entryByPath(next.focusedPath);
				if (entry && !entry.isDirectory && !event.shiftKey) openPreviewForEntry(entry);
				return;
			}

			if (event.key === "Enter" && selection.focusedEntry) {
				event.preventDefault();
				const focused = selection.focusedEntry;
				handleSelectEntry(focused, { toggle: false, range: false, activate: true });
				if (focused.isDirectory) toggleDir(focused.path);
				return;
			}

			if (event.key === "F2" && selection.selectedEntries.length === 1) {
				event.preventDefault();
				setRenamingPath(selection.selectedEntries[0]?.path ?? null);
				return;
			}

			if ((event.key === "Delete" || event.key === "Backspace") && selection.selectedEntries.length > 0) {
				event.preventDefault();
				requestDelete(selection.selectedEntries);
				return;
			}

			if (event.key === "Escape") {
				event.preventDefault();
				selection.clear();
				return;
			}

			if (mod && key === "a") {
				event.preventDefault();
				selection.selectAll();
				return;
			}

			if (mod && key === "c" && selection.selectedEntries.length > 0) {
				event.preventDefault();
				copyEntriesToClipboard(selection.selectedEntries);
				return;
			}

			if (mod && key === "v") {
				event.preventDefault();
				beginPaste();
			}
		},
		[
			beginPaste,
			copyEntriesToClipboard,
			creatingEntry,
			handleSelectEntry,
			openPreviewForEntry,
			renamingPath,
			requestDelete,
			selection,
			setRenamingPath,
			toggleDir,
		],
	);

	if (!rootDir) {
		return {
			rootDir: null,
			labels: {
				selectProject: t("fileExplorer.selectProject"),
				headerTitle: t("fileExplorer.fileList"),
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

	const clearArtifactsButton: ReactNode = clearArtifactsScope ? (
		<Button
			variant="ghost"
			size="icon-xs"
			title={t("fileExplorer.clearArtifacts")}
			onClick={handleClearArtifacts}
		>
			<span className="icon-[solar--broom-linear] h-3.5 w-3.5" />
		</Button>
	) : undefined;

	const refreshButton = (
		<Button
			variant="ghost"
			size="icon-xs"
			title={t("fileExplorer.refresh")}
			onClick={() => void refreshDir(rootDir)}
		>
			<span className="icon-[solar--refresh-linear] h-3.5 w-3.5" />
		</Button>
	);

	const workspaceRoot = { name: projectName, path: rootDir };
	const pluginToolbarActionNodes = sortFileExplorerActions(pluginToolbarActions).map((action) => (
		<Button
			key={action.actionId}
			variant="ghost"
			size="icon-xs"
			title={resolvePluginText(action.pluginId, action.label)}
			onClick={() => {
				void Promise.resolve(
					action.run({
						workspaceRoot: { ...workspaceRoot },
						selection: selection.selectedEntries.map((entry) => ({ ...entry })),
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
	const toolbarActions = (
		<>
			<Button
				variant="ghost"
				size="icon-xs"
				title={t("fileExplorer.newFile")}
				onClick={() => beginCreate("file")}
			>
				<span className="icon-[solar--document-add-linear] h-3.5 w-3.5" />
			</Button>
			<Button
				variant="ghost"
				size="icon-xs"
				title={t("fileExplorer.newFolder")}
				onClick={() => beginCreate("directory")}
			>
				<span className="icon-[solar--add-folder-linear] h-3.5 w-3.5" />
			</Button>
			<Button
				variant="ghost"
				size="icon-xs"
				title={t("fileExplorer.collapseAll")}
				onClick={() => {
					setCreatingEntry(null);
					collapseAll();
				}}
			>
				<span className="icon-[solar--minimize-square-linear] h-3.5 w-3.5" />
			</Button>
			{pluginToolbarActionNodes}
		</>
	);

	const tree = (
		<FileTree
			rootDir={rootDir}
			cache={cache}
			expandedDirs={expandedDirs}
			loadingDirs={loadingDirs}
			selectedPaths={selection.selectedPaths}
			focusedPath={selection.focusedPath}
			creatingEntry={creatingEntry}
			onToggleDir={toggleDir}
			onSelectEntry={handleSelectEntry}
			onSelectPaths={selection.selectPaths}
			onBackgroundClick={handleBackgroundClick}
			onRename={renameEntry}
			onFileMove={onFileMove}
			onExternalDrop={onExternalDrop}
			onNativeDragStart={onNativeDragStart}
			onPrefetchNativeDragIcons={onPrefetchNativeDragIcons}
			onContextMenu={onContextMenu}
			onRootContextMenu={onRootContextMenu}
			onCreateSubmit={handleCreateSubmit}
			onCreateCancel={() => setCreatingEntry(null)}
			onTreeKeyDown={handleTreeKeyDown}
		/>
	);

	// Entry menu targets: multi-select if the clicked row is inside the set; else the single entry.
	const contextMenuTargets =
		contextMenu && !contextMenu.isRoot && selection.selectedPaths.has(contextMenu.entry.path)
			? selection.selectedEntries
			: contextMenu
				? [contextMenu.entry]
				: [];

	const contextMenuNode = contextMenu ? (
		<FileContextMenu
			x={contextMenu.x}
			y={contextMenu.y}
			entry={contextMenu.entry}
			isRoot={contextMenu.isRoot}
			targetEntries={contextMenuTargets}
			canPaste={clipboard != null && clipboard.entries.length > 0}
			onClose={() => setContextMenu(null)}
			onDelete={requestDelete}
			onCreate={beginCreate}
			onCopy={copyEntriesToClipboard}
			onPaste={() => beginPaste(contextMenu.isRoot ? rootDir : undefined)}
			onCopyPath={copyPathsToSystemClipboard}
		/>
	) : null;

	const deleteDialog = deleteTargets ? (
		<ConfirmDeleteDialog
			entries={deleteTargets}
			onConfirm={() => void handleDeleteConfirm()}
			onCancel={() => setDeleteTargets(null)}
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
			headerTitle: t("fileExplorer.fileList"),
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
