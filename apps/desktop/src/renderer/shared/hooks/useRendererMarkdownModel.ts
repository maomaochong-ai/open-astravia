import { getFileIcon } from "@astravia-org/theme-ui/shared/fileIcons";
import { useNarrowScreen } from "@shared/hooks/useNarrowScreen";
import { resolveLocalFilePath } from "@shared/lib/resolve-local-file-path";
import { isSubPath, pathBasename } from "@shared/lib/utils";
import type { RendererMarkdownModel } from "@shared/models/renderer-markdown-model";
import {
	activeSessionAtom,
	filePreviewAtom,
	openFileInActivityWorkspaceAtom,
	openUrlInActivityWorkspaceAtom,
	resolvedThemeAtom,
} from "@shared/store/atoms";
import { atom, useAtomValue, useSetAtom } from "jotai";
import { selectAtom } from "jotai/utils";
import { useCallback, useMemo } from "react";
import { useMarkdownHost } from "./useMarkdownHost";
import { useMarkdownLabels } from "./useMarkdownLabels";

const activeCwdAtom = selectAtom(activeSessionAtom, (session) => session?.cwd ?? null);
const noActiveCwdAtom = atom(null);

/** Connects renderer state and file/url actions to the host-neutral markdown view. */
export function useRendererMarkdownModel(
	cwdOverride?: string | null,
	preferInlinePreview = true,
	workspaceIdOverride?: string,
): RendererMarkdownModel {
	const labels = useMarkdownLabels();
	const theme = useAtomValue(resolvedThemeAtom);
	const activeCwd = useAtomValue(cwdOverride === undefined ? activeCwdAtom : noActiveCwdAtom);
	const setFilePreview = useSetAtom(filePreviewAtom);
	const openFileInWorkspace = useSetAtom(openFileInActivityWorkspaceAtom);
	const openUrlInWorkspace = useSetAtom(openUrlInActivityWorkspaceAtom);
	const narrow = useNarrowScreen();
	const cwd = cwdOverride === undefined ? activeCwd : cwdOverride;
	const workspaceId = workspaceIdOverride ?? cwd;
	const host = useMarkdownHost(cwd);

	const onOpenFile = useCallback(
		(path: string) => {
			const resolved = resolveLocalFilePath(path, cwd);
			const name = pathBasename(resolved);
			if (preferInlinePreview && !narrow && cwd && isSubPath(resolved, cwd)) {
				// 打开预览的同时让文件树定位到这份文件：交付物是代码时，用户点进来要能顺着
				// 目录把它放到项目里的位置，而不是停在上一次浏览的目录。
				if (workspaceId) openFileInWorkspace({ workspaceId, path: resolved });
				return;
			}
			setFilePreview({ name, path: resolved });
		},
		[preferInlinePreview, narrow, cwd, workspaceId, setFilePreview, openFileInWorkspace],
	);
	const onOpenUrl = useCallback(
		(url: string) => {
			if (workspaceId) openUrlInWorkspace({ workspaceId, url });
		},
		[openUrlInWorkspace, workspaceId],
	);
	const getFileIconClass = useCallback((fileName: string) => getFileIcon(fileName, false, false), []);

	return useMemo(
		() => ({
			theme: theme === "dark" ? "dark" : "light",
			labels,
			host,
			getFileIconClass,
			onOpenFile,
			onOpenUrl,
		}),
		[theme, labels, host, getFileIconClass, onOpenFile, onOpenUrl],
	);
}
