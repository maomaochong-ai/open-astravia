import { recordInputImagesAdded } from "@shared/lib/app-monitor-events";
import type { InputBarContextMenuViewProps } from "@vetta/theme-ui/chat";
import type { MouseEvent } from "react";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { insertClipboardMessage } from "./editor/clipboard-message";
import { focusInputEditor, insertPlainText, readSelectionText, removeSelection } from "./editor/inputEditorHandle";

const CONTEXT_MENU_WIDTH = 160;
const CONTEXT_MENU_HEIGHT = 112;
const CONTEXT_MENU_VIEWPORT_GAP = 8;

interface ContextMenuState {
	canCopy: boolean;
	canCut: boolean;
	canPaste: boolean;
	x: number;
	y: number;
}

function clampPosition(clientX: number, clientY: number): { x: number; y: number } {
	return {
		x: Math.max(
			CONTEXT_MENU_VIEWPORT_GAP,
			Math.min(clientX, window.innerWidth - CONTEXT_MENU_WIDTH - CONTEXT_MENU_VIEWPORT_GAP),
		),
		y: Math.max(
			CONTEXT_MENU_VIEWPORT_GAP,
			Math.min(clientY, window.innerHeight - CONTEXT_MENU_HEIGHT - CONTEXT_MENU_VIEWPORT_GAP),
		),
	};
}

async function clipboardHasText(): Promise<boolean> {
	try {
		return (await navigator.clipboard.readText()).length > 0;
	} catch {
		return true;
	}
}

export function useInputBarContextMenuModel({
	activeRuntimeId,
	hasSession,
}: {
	activeRuntimeId?: string;
	hasSession: boolean;
}) {
	const { t } = useTranslation("chat");
	const [state, setState] = useState<ContextMenuState | null>(null);
	const close = useCallback(() => setState(null), []);
	const onContextMenu = useCallback(
		(e: MouseEvent<HTMLDivElement>) => {
			e.preventDefault();
			if (!hasSession) return;
			const selected = readSelectionText().length > 0;
			void clipboardHasText().then((canPaste) => {
				setState({ ...clampPosition(e.clientX, e.clientY), canCopy: selected, canCut: selected, canPaste });
			});
		},
		[hasSession],
	);
	const onCopy = useCallback(() => {
		close();
		const selected = readSelectionText();
		if (selected)
			void navigator.clipboard.writeText(selected).catch((error) => console.warn("[InputBar] copy failed", error));
	}, [close]);
	const onCut = useCallback(() => {
		close();
		const selected = readSelectionText();
		if (!selected) return;
		void navigator.clipboard.writeText(selected).catch((error) => console.warn("[InputBar] cut failed", error));
		removeSelection();
		focusInputEditor();
	}, [close]);
	const onPaste = useCallback(() => {
		close();
		if (!hasSession) return;
		void (async () => {
			try {
				const rich = await window.vetta.clipboard.pasteUserMessage(activeRuntimeId ?? "draft");
				if (rich) {
					recordInputImagesAdded("paste", rich.images);
					insertClipboardMessage(
						rich.text,
						rich.images.map((image) => image.path),
					);
					focusInputEditor();
					return;
				}
			} catch (error) {
				console.warn("[InputBar] rich clipboard read failed", error);
			}
			try {
				const text = await navigator.clipboard.readText();
				if (text) {
					insertPlainText(text);
					focusInputEditor();
				}
			} catch (error) {
				console.warn("[InputBar] paste clipboard read failed", error);
			}
		})();
	}, [activeRuntimeId, close, hasSession]);

	const contextMenu: InputBarContextMenuViewProps | null = state
		? {
				...state,
				labels: {
					copy: t("inputBar.contextMenu.copy"),
					cut: t("inputBar.contextMenu.cut"),
					paste: t("inputBar.contextMenu.paste"),
				},
				onClose: close,
				onCopy,
				onCut,
				onPaste,
			}
		: null;

	return { contextMenu, onContextMenu };
}
