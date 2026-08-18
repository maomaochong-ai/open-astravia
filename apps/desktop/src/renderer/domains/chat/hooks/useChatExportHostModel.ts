import type { ChatMessage } from "@shared/store/atoms";
import { authUserAtom } from "@shared/store/auth-atoms";
import { useAtomValue } from "jotai";
import { type RefObject, useEffect, useRef } from "react";
import { buildChatHtmlDocument } from "../services/chat-html-export";

function nextPaint(): Promise<void> {
	return new Promise((resolve) => {
		requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
	});
}

function safeFileName(value: string): string {
	const normalized = value.trim().replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_");
	return `${normalized || "Vetta 会话"}.html`;
}

export interface ChatExportHostModel {
	rootRef: RefObject<HTMLDivElement | null>;
}

export function useChatExportHostModel({
	title,
	onFinished,
}: {
	messages: ChatMessage[];
	title: string;
	onFinished: () => void;
}): ChatExportHostModel {
	const rootRef = useRef<HTMLDivElement>(null);
	const authUser = useAtomValue(authUserAtom);

	useEffect(() => {
		let cancelled = false;
		void (async () => {
			try {
				await document.fonts.ready;
				await nextPaint();
				const root = rootRef.current;
				if (!root || cancelled) return;
				const html = await buildChatHtmlDocument(root, title, authUser?.nickname);
				if (cancelled) return;
				await window.vetta.dialog.saveHtml(safeFileName(title), html);
			} catch (error) {
				console.error("[ChatExport] export failed", error);
				if (!cancelled) {
					alert(error instanceof Error ? `导出失败：${error.message}` : "导出失败");
				}
			} finally {
				if (!cancelled) onFinished();
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [onFinished, title, authUser?.nickname]);

	return { rootRef };
}
