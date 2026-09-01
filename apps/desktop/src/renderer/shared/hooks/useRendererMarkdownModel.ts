import { useNarrowScreen } from "@shared/hooks/useNarrowScreen";
import { resolveLocalFilePath } from "@shared/lib/resolve-local-file-path";
import { isSubPath, pathBasename } from "@shared/lib/utils";
import type { RendererMarkdownModel } from "@shared/models/renderer-markdown-model";
import {
	activeSessionAtom,
	activityPanelOpenAtom,
	activityPanelTabByProjectAtom,
	filePreviewAtom,
	openInlineFilePreviewAtom,
	openUrlInBrowserAtom,
	resolvedThemeAtom,
} from "@shared/store/atoms";
import { getFileIcon } from "@vetta/theme-ui/file-explorer";
import { useAtomValue, useSetAtom } from "jotai";
import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";

/** Connects renderer state and file/url actions to the host-neutral markdown view. */
export function useRendererMarkdownModel(
	cwdOverride?: string | null,
	preferInlinePreview = true,
): RendererMarkdownModel {
	const { t } = useTranslation("chat");
	const theme = useAtomValue(resolvedThemeAtom);
	const activeSession = useAtomValue(activeSessionAtom);
	const setFilePreview = useSetAtom(filePreviewAtom);
	const openInlineFilePreview = useSetAtom(openInlineFilePreviewAtom);
	const setActivityPanelOpen = useSetAtom(activityPanelOpenAtom);
	const setActivityTabByProject = useSetAtom(activityPanelTabByProjectAtom);
	const openUrlInBrowser = useSetAtom(openUrlInBrowserAtom);
	const narrow = useNarrowScreen();
	const cwd = cwdOverride === undefined ? (activeSession?.cwd ?? null) : cwdOverride;

	const onOpenFile = useCallback(
		(path: string) => {
			const resolved = resolveLocalFilePath(path, cwd);
			const name = pathBasename(resolved);
			if (preferInlinePreview && !narrow && cwd && isSubPath(resolved, cwd)) {
				setActivityPanelOpen(true);
				setActivityTabByProject((previous) => new Map(previous).set(cwd, "file"));
				openInlineFilePreview({ name, path: resolved });
				return;
			}
			setFilePreview({ name, path: resolved });
		},
		[
			preferInlinePreview,
			narrow,
			cwd,
			setFilePreview,
			openInlineFilePreview,
			setActivityPanelOpen,
			setActivityTabByProject,
		],
	);
	const onOpenUrl = useCallback((url: string) => openUrlInBrowser(url), [openUrlInBrowser]);
	const getFileIconClass = useCallback((fileName: string) => getFileIcon(fileName, false, false), []);
	const labels = useMemo(() => ({ copy: t("copyButton.label"), copied: t("copyButton.copied") }), [t]);

	return useMemo(
		() => ({
			theme: theme === "dark" ? "dark" : "light",
			labels,
			getFileIconClass,
			onOpenFile,
			onOpenUrl,
		}),
		[theme, labels, getFileIconClass, onOpenFile, onOpenUrl],
	);
}
