import { type MouseEvent, useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { copyUserMessageToClipboard } from "../services/user-message-clipboard";

const CONTEXT_MENU_WIDTH = 170;
const CONTEXT_MENU_HEIGHT = 112;
const CONTEXT_MENU_VIEWPORT_GAP = 8;

export function useUserMessageCopyAction(copyText: string, imageSources: readonly string[]) {
	return useCallback(() => copyUserMessageToClipboard(copyText, imageSources), [copyText, imageSources]);
}

export function useUserMessageContextMenu({
	canCopy,
	canDelete,
	canEdit,
	onCopy,
	onDelete,
	onEdit,
}: {
	readonly canCopy: boolean;
	readonly canDelete: boolean;
	readonly canEdit: boolean;
	readonly onCopy: () => Promise<void>;
	readonly onDelete: () => void;
	readonly onEdit: () => void;
}) {
	const { t } = useTranslation("chat");
	const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
	const close = useCallback(() => setPosition(null), []);
	const onContextMenu = useCallback((event: MouseEvent<HTMLDivElement>) => {
		event.preventDefault();
		setPosition({
			x: Math.max(
				CONTEXT_MENU_VIEWPORT_GAP,
				Math.min(event.clientX, window.innerWidth - CONTEXT_MENU_WIDTH - CONTEXT_MENU_VIEWPORT_GAP),
			),
			y: Math.max(
				CONTEXT_MENU_VIEWPORT_GAP,
				Math.min(event.clientY, window.innerHeight - CONTEXT_MENU_HEIGHT - CONTEXT_MENU_VIEWPORT_GAP),
			),
		});
	}, []);
	return {
		model: position
			? {
					canCopy,
					canDelete,
					canEdit,
					labels: {
						copy: t("messageList.contextMenu.copy"),
						delete: t("messageList.contextMenu.delete"),
						edit: t("messageList.contextMenu.edit"),
					},
					onClose: close,
					onCopy: () => {
						close();
						if (!canCopy) return;
						void onCopy().catch((error) => console.warn("[UserMessage] copy failed", error));
					},
					onDelete: () => {
						close();
						onDelete();
					},
					onEdit: () => {
						close();
						onEdit();
					},
					x: position.x,
					y: position.y,
				}
			: null,
		onContextMenu,
	};
}
