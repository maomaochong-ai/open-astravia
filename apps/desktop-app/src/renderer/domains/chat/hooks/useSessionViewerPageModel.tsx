import { useParams } from "@tanstack/react-router";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@shared/components/ui/button";
import {
	activityPanelOpenAtom,
	defaultImConversationCwdAtom,
	closeInlineFilePreviewAtom,
	inlineFilePreviewContextReadonlyAtom,
	knowledgeProcessingCwdAtom,
	pageHeaderRightSlotAtom,
	type ChatMessage,
} from "@shared/store/atoms";
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
	messages: ChatMessage[];
	exporting: boolean;
	exportTitle: string;
	isKnowledge: boolean;
	imCwd: string;
	kbCwd: string;
	emptyPathLabel: string;
	errorPrefix: string;
	onExportFinished: () => void;
}

export function useSessionViewerPageModel(): SessionViewerPageModel {
	const { t } = useTranslation("chat");
	// biome-ignore lint/suspicious/noExplicitAny: route params typing
	const params = useParams({ strict: false }) as any;
	const encodedPath = params.path as string | undefined;
	const path = encodedPath ? decodeURIComponent(encodedPath) : "";

	const [messages, setMessages] = useState<ChatMessage[]>([]);
	const [error, setError] = useState<string | null>(null);
	const [exporting, setExporting] = useState(false);
	const setHeaderRight = useSetAtom(pageHeaderRightSlotAtom);
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
		const badgeLabel = isIm ? t("sessionViewer.badge.liveUpdate") : t("sessionViewer.badge.readOnly");
		const badgeClass = isIm
			? "rounded bg-primary/15 px-1.5 py-[1px] text-[10px] font-semibold uppercase tracking-wide text-primary"
			: "rounded bg-muted/60 px-1.5 py-[1px] text-[10px] font-semibold uppercase tracking-wide text-muted-foreground";
		const header: ReactNode = (
			<div className="flex items-center gap-2 text-[12px] text-muted-foreground">
				<span className="hidden truncate sm:inline">{t("sessionViewer.header.subtitle")}</span>
				<span className={badgeClass}>{badgeLabel}</span>
				<Button
					size="icon-xs"
					variant="ghost"
					title={t("sessionViewer.exportButton.title")}
					disabled={messages.length === 0 || exporting}
					onClick={() => setExporting(true)}
				>
					<span
						className={
							exporting
								? "icon-[mdi--loading] animate-spin text-[14px]"
								: "icon-[mdi--language-html5] text-[14px]"
						}
					/>
				</Button>
				<Button
					size="icon-xs"
					variant="ghost"
					title={
						panelOpen
							? t("sessionViewer.panelToggleButton.titleClose")
							: t("sessionViewer.panelToggleButton.titleOpen")
					}
					onClick={handleTogglePanel}
					className={panelOpen ? "bg-accent text-foreground" : ""}
				>
					<span className="icon-[solar--sidebar-minimalistic-linear] -scale-x-100 text-[14px]" />
				</Button>
			</div>
		);
		setHeaderRight(header);
		return () => setHeaderRight(null);
	}, [isIm, panelOpen, handleTogglePanel, setHeaderRight, messages.length, exporting, t]);

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
		imCwd: imCwd || "",
		kbCwd: kbCwd || "",
		emptyPathLabel: t("sessionViewer.emptyState.noPath"),
		errorPrefix: "加载失败：",
		onExportFinished: handleExportFinished,
	};
}
