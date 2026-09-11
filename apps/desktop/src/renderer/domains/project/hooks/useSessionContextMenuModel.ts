import type { SessionContextMenuSession } from "@shared/store/atoms";
import {
	conversationTagEditorAtom,
	conversationTagsAtom,
	pinnedSessionPathsAtom,
	renamingSessionPathAtom,
	setSessionPinnedAtom,
} from "@shared/store/atoms";
import type { SessionContextMenuViewProps } from "@vetta/theme-ui/project";
import type { ContextMenuNode } from "@vetta/theme-ui/shared";
import { useAtomValue, useSetAtom } from "jotai";
import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { conversationTagIds } from "../../../../shared/conversation-tags";

const isMac = navigator.platform.toUpperCase().includes("MAC");

export function useSessionContextMenuModel(
	session: SessionContextMenuSession,
	allowMutations: boolean,
	canTag: boolean,
	onClose: () => void,
	onDelete: (session: SessionContextMenuSession) => void,
): Omit<SessionContextMenuViewProps, "x" | "y"> {
	const { t } = useTranslation("project");
	const setRenamingSessionPath = useSetAtom(renamingSessionPathAtom);
	const pinnedSessionPaths = useAtomValue(pinnedSessionPathsAtom);
	const setSessionPinned = useSetAtom(setSessionPinnedAtom);
	const tags = useAtomValue(conversationTagsAtom);
	const openTagEditor = useSetAtom(conversationTagEditorAtom);
	const pinned = pinnedSessionPaths.has(session.path);

	const handleRename = useCallback(() => {
		setRenamingSessionPath(session.path);
		onClose();
	}, [onClose, session.path, setRenamingSessionPath]);

	const handleOpenInFolder = useCallback(() => {
		void window.vetta.shell.showInFolder(session.cwd);
		onClose();
	}, [onClose, session.cwd]);

	const handleDelete = useCallback(() => {
		onDelete(session);
	}, [onDelete, session]);
	const handleTogglePin = useCallback(() => {
		setSessionPinned({ path: session.path, pinned: !pinned });
		onClose();
	}, [onClose, pinned, session.path, setSessionPinned]);

	const extraItems = useMemo<readonly ContextMenuNode[] | undefined>(() => {
		if (!canTag) return undefined;
		const assigned = new Set(conversationTagIds(tags, session.path));
		const items: ContextMenuNode[] = [
			{
				kind: "item",
				id: "tag-new",
				label: t("contextMenu.tags.new"),
				iconClassName: "icon-[solar--add-circle-linear]",
				onSelect: () => {
					openTagEditor({ mode: "create", sessionPath: session.path });
					onClose();
				},
			},
		];
		// 一个标签都没有时不画分割线与「管理标签…」——没东西可管。
		if (tags.tags.length > 0) {
			items.push({ kind: "separator", id: "tag-sep" });
			for (const tag of tags.tags) {
				const checked = assigned.has(tag.id);
				items.push({
					kind: "item",
					id: `tag-${tag.id}`,
					label: tag.name,
					dotColor: tag.color,
					checked,
					onSelect: () => {
						void window.vetta.conversationTags.assign({
							sessionPath: session.path,
							tagId: tag.id,
							assigned: !checked,
						});
						onClose();
					},
				});
			}
			items.push({ kind: "separator", id: "tag-manage-sep" });
			items.push({
				kind: "item",
				id: "tag-manage",
				label: t("contextMenu.tags.manage"),
				iconClassName: "icon-[solar--settings-linear]",
				onSelect: () => {
					openTagEditor({ mode: "manage" });
					onClose();
				},
			});
		}
		return [
			{
				kind: "submenu",
				id: "tags",
				label: t("contextMenu.tags.label"),
				iconClassName: "icon-[solar--tag-linear]",
				items,
			},
		];
	}, [canTag, onClose, openTagEditor, session.path, t, tags]);

	return {
		canDelete: allowMutations && session.access?.delete !== false,
		canRename: allowMutations && session.access?.rename !== false,
		extraItems,
		labels: {
			pin: pinned ? t("contextMenu.unpin") : t("contextMenu.pin"),
			rename: t("contextMenu.rename"),
			openInFolder: isMac ? t("contextMenu.openInFinder") : t("contextMenu.openInExplorer"),
			delete: t("contextMenu.delete"),
		},
		onClose,
		onDelete: handleDelete,
		onOpenInFolder: handleOpenInFolder,
		onRename: handleRename,
		onTogglePin: handleTogglePin,
	};
}
