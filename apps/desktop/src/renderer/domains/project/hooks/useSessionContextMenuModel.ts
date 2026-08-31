import type { SessionInfo } from "@shared/store/atoms";
import { pinnedSessionPathsAtom, renamingSessionPathAtom, setSessionPinnedAtom } from "@shared/store/atoms";
import type { SessionContextMenuViewProps } from "@vetta/theme-ui/project";
import { useAtomValue, useSetAtom } from "jotai";
import { useCallback } from "react";
import { useTranslation } from "react-i18next";

const isMac = navigator.platform.toUpperCase().includes("MAC");

export function useSessionContextMenuModel(
	session: SessionInfo,
	allowMutations: boolean,
	onClose: () => void,
	onDelete: (session: SessionInfo) => void,
): Omit<SessionContextMenuViewProps, "x" | "y"> {
	const { t } = useTranslation("project");
	const setRenamingSessionPath = useSetAtom(renamingSessionPathAtom);
	const pinnedSessionPaths = useAtomValue(pinnedSessionPathsAtom);
	const setSessionPinned = useSetAtom(setSessionPinnedAtom);
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

	return {
		canDelete: allowMutations && session.access?.delete !== false,
		canRename: allowMutations && session.access?.rename !== false,
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
