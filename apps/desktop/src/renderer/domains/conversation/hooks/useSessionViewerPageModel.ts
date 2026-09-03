import {
	activityPanelOpenAtom,
	type ChatConversationItem,
	closeInlineFilePreviewAtom,
	defaultImConversationCwdAtom,
	inlineFilePreviewContextReadonlyAtom,
	knowledgeProcessingCwdAtom,
} from "@shared/store/atoms";
import { useParams } from "@tanstack/react-router";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { fullHistoryToChat } from "../services/chat-service";

/**
 * 判断 filePath 是否位于 dir 目录之下，分隔符无关（Windows 上 session path 用反斜杠、
 * 手动拼 `dir + "/"` 前缀会因 `\` vs `/` 匹配失败，导致 KB/IM 面板判定为 false）。
 */
function isPathUnderDir(filePath: string, dir: string): boolean {
	if (!filePath || !dir) return false;
	const norm = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "");
	return `${norm(filePath)}/`.startsWith(`${norm(dir)}/`);
}

export interface SessionViewerPageModel {
	path: string;
	error: string | null;
	messages: ChatConversationItem[];
	exporting: boolean;
	exportTitle: string;
	isKnowledge: boolean;
	isIm: boolean;
	imCwd: string;
	kbCwd: string;
	panelOpen: boolean;
	emptyPathLabel: string;
	errorPrefix: string;
	onStartExport: () => void;
	onTogglePanel: () => void;
	onExportFinished: () => void;
}

export function useSessionViewerPageModel(): SessionViewerPageModel {
	const { t } = useTranslation("chat");
	const params = useParams({ strict: false }) as { path?: string };
	const encodedPath = params.path as string | undefined;
	const path = encodedPath ? decodeURIComponent(encodedPath) : "";

	const [messages, setMessages] = useState<ChatConversationItem[]>([]);
	const [error, setError] = useState<string | null>(null);
	const [exporting, setExporting] = useState(false);
	const imCwd = useAtomValue(defaultImConversationCwdAtom);
	const kbCwd = useAtomValue(knowledgeProcessingCwdAtom);
	const [panelOpen, setPanelOpen] = useAtom(activityPanelOpenAtom);
	const inlinePreviewCtx = useAtomValue(inlineFilePreviewContextReadonlyAtom);
	const inlinePreviewActive = inlinePreviewCtx !== null;
	const closeInlinePreview = useSetAtom(closeInlineFilePreviewAtom);
	const isIm = useMemo(() => isPathUnderDir(path, imCwd), [path, imCwd]);
	const exportTitle = useMemo(() => {
		const fileName = path.split(/[\\/]/).at(-1) ?? t("sessionViewer.export.defaultTitle");
		return fileName.replace(/\.jsonl$/i, "");
	}, [path, t]);
	const handleStartExport = useCallback(() => setExporting(true), []);
	const handleExportFinished = useCallback(() => setExporting(false), []);
	const isKnowledge = useMemo(() => isPathUnderDir(path, kbCwd), [path, kbCwd]);

	const handleTogglePanel = useCallback(() => {
		if (inlinePreviewActive) {
			closeInlinePreview();
			setPanelOpen(false);
			return;
		}
		setPanelOpen((o) => !o);
	}, [inlinePreviewActive, closeInlinePreview, setPanelOpen]);

	useEffect(() => {
		if (!path) return;
		let cancelled = false;
		let unsubscribe: (() => void) | undefined;

		(async () => {
			try {
				const initial = await window.vetta.session.openViewer(path);
				if (cancelled) return;
				setMessages(fullHistoryToChat(initial.history));

				unsubscribe = await window.vetta.session.subscribeViewer(path, (snapshot) => {
					setMessages(fullHistoryToChat(snapshot.history));
				});
				if (cancelled) unsubscribe?.();
			} catch (err) {
				if (!cancelled) setError((err as Error).message);
			}
		})();

		return () => {
			cancelled = true;
			unsubscribe?.();
		};
	}, [path]);

	return {
		path,
		error,
		messages,
		exporting,
		exportTitle,
		isKnowledge,
		isIm,
		imCwd: imCwd || "",
		kbCwd: kbCwd || "",
		panelOpen,
		emptyPathLabel: t("sessionViewer.emptyState.noPath"),
		errorPrefix: t("sessionViewer.error.loadPrefix"),
		onStartExport: handleStartExport,
		onTogglePanel: handleTogglePanel,
		onExportFinished: handleExportFinished,
	};
}
