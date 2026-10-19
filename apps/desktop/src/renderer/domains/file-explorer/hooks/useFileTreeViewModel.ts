import type {
	FileExplorerCreatingEntry,
	FileExplorerDragEntry,
	FileExplorerSelectOptions,
	FileTreeViewProps,
} from "@astravia-org/theme-ui/file-explorer";
import {
	type FsEntry,
	fileExplorerPreferencesAtom,
	pluginFileExplorerDecorationProvidersAtom,
	pluginFileIconThemesAtom,
	renamingPathAtom,
	resolvedThemeAtom,
} from "@shared/store/atoms";
import { useAtom, useAtomValue } from "jotai";
import { createElement, type KeyboardEvent, useCallback, useMemo, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { PluginInlineI18nBoundary, usePluginTextResolver } from "../../plugins/runtime/plugin-i18n";
import { resolveFileIconTheme } from "../services/file-icon-theme";
import { createFileExplorerDecorations } from "../services/plugin-contributions";
import { gitStatusColor, useGitStatus } from "./useGitStatus";

const contrastQuery = "(forced-colors: active), (prefers-contrast: more)";
function subscribeContrast(listener: () => void): () => void {
	const query = window.matchMedia?.(contrastQuery);
	query?.addEventListener("change", listener);
	return () => query?.removeEventListener("change", listener);
}
function getContrast(): boolean {
	return window.matchMedia?.(contrastQuery).matches ?? false;
}

/** 返回 entry 相对于 rootDir 的路径（统一用 / 分隔），用于匹配 git status 输出。 */
function relativePath(entryPath: string, rootDir: string): string {
	const normalize = (p: string): string => p.replace(/\\/g, "/");
	const base = normalize(rootDir).replace(/\/+$/, "");
	const full = normalize(entryPath);
	if (full === base) return ".";
	if (full.startsWith(`${base}/`)) return full.slice(base.length + 1);
	return full;
}

export function useFileTreeViewModel(input: {
	rootDir: string;
	cache: Map<string, FsEntry[]>;
	expandedDirs: Set<string>;
	loadingDirs: Set<string>;
	selectedPaths: ReadonlySet<string>;
	focusedPath: string | null;
	creatingEntry: FileExplorerCreatingEntry | null;
	onToggleDir: (path: string) => void;
	onSelectEntry: (entry: FsEntry, options: FileExplorerSelectOptions) => void;
	onSelectPaths: (paths: readonly string[]) => void;
	onBackgroundClick: () => void;
	onRename: (oldPath: string, newName: string) => Promise<void>;
	onFileMove: (srcPaths: readonly string[], destDir: string) => void;
	onExternalDrop: (files: readonly File[], destDir: string) => void;
	onNativeDragStart: (paths: readonly string[]) => void;
	onPrefetchNativeDragIcons?: (entries: readonly FileExplorerDragEntry[]) => void;
	onContextMenu: (entry: FsEntry, x: number, y: number) => void;
	onRootContextMenu: (x: number, y: number) => void;
	onCreateSubmit: (name: string) => void;
	onCreateCancel: () => void;
	onTreeKeyDown?: (event: KeyboardEvent<HTMLDivElement>) => void;
}): FileTreeViewProps {
	const { t } = useTranslation("chat");
	const [renamingPath, setRenamingPath] = useAtom(renamingPathAtom);
	const decorationProviders = useAtomValue(pluginFileExplorerDecorationProvidersAtom);
	const resolvePluginText = usePluginTextResolver();
	const themes = useAtomValue(pluginFileIconThemesAtom);
	const preferences = useAtomValue(fileExplorerPreferencesAtom);
	const mode = useAtomValue(resolvedThemeAtom);
	const highContrast = useSyncExternalStore(subscribeContrast, getContrast, () => false);
	const gitStatus = useGitStatus(input.rootDir);
	const iconTheme = themes.find((theme) => theme.id === preferences.iconTheme);
	const decorations = useMemo(
		() => createFileExplorerDecorations(input.rootDir, input.cache, decorationProviders),
		[input.rootDir, input.cache, decorationProviders],
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

	const getDecoration = useCallback(
		(entry: FsEntry) => {
			const relPath = input.rootDir ? relativePath(entry.path, input.rootDir) : entry.path;
			const gitCode = gitStatus.get(relPath);
			const gitColor = gitCode ? gitStatusColor(gitCode) : null;
			const resolved = decorations.get(entry.path);
			const decoration = resolved?.decoration;
			const themeIcon = iconTheme
				? resolveFileIconTheme(
						iconTheme,
						entry,
						input.expandedDirs.has(entry.path),
						highContrast ? "highContrast" : mode,
					)
				: undefined;
			const icon = themeIcon ?? decoration?.icon;
			const iconPlugin = themeIcon != null ? iconTheme?.pluginId : resolved?.pluginId;
			return {
				...decoration,
				// 插件装饰优先级更高；无插件 color 时回退到 git 状态色。
				color: decoration?.color ?? gitColor ?? undefined,
				tooltip:
					decoration?.tooltip && resolved ? resolvePluginText(resolved.pluginId, decoration.tooltip) : undefined,
				icon:
					icon && iconPlugin ? createElement(PluginInlineI18nBoundary, { pluginId: iconPlugin }, icon) : undefined,
			};
		},
		[decorations, resolvePluginText, iconTheme, input.expandedDirs, mode, highContrast, gitStatus, input.rootDir],
	);

	return {
		rootDir: input.rootDir,
		cache: input.cache,
		expandedDirs: input.expandedDirs,
		loadingDirs: input.loadingDirs,
		selectedPaths: input.selectedPaths,
		focusedPath: input.focusedPath,
		renamingPath,
		creatingEntry: input.creatingEntry,
		emptyLabel: t("fileExplorer.emptyFolder"),
		createInputLabel:
			input.creatingEntry?.kind === "directory"
				? t("fileExplorer.newFolderInputLabel")
				: t("fileExplorer.newFileInputLabel"),
		getDecoration,
		onToggleDir: input.onToggleDir,
		onSelectEntry: input.onSelectEntry,
		onSelectPaths: input.onSelectPaths,
		onBackgroundClick: input.onBackgroundClick,
		onContextMenu: input.onContextMenu,
		onRootContextMenu: input.onRootContextMenu,
		onRenameSubmit,
		onRenameCancel,
		onCreateSubmit: input.onCreateSubmit,
		onCreateCancel: input.onCreateCancel,
		onFileMove: input.onFileMove,
		onExternalDrop: input.onExternalDrop,
		onNativeDragStart: input.onNativeDragStart,
		onPrefetchNativeDragIcons: input.onPrefetchNativeDragIcons,
		onTreeKeyDown: input.onTreeKeyDown,
	};
}
