import type { SessionInfo } from "@shared/store/atoms";
import { renamingSessionPathAtom } from "@shared/store/atoms";
import type { SessionContextMenuViewProps } from "@vetta/theme-ui/project";
import { useSetAtom } from "jotai";
import { useCallback } from "react";
import { useTranslation } from "react-i18next";

const isMac = navigator.platform.toUpperCase().includes("MAC");

export function useSessionContextMenuModel(
	session: SessionInfo,
	onClose: () => void,
	onDelete: (session: SessionInfo) => void,
): Omit<SessionContextMenuViewProps, "x" | "y"> {
	const { t } = useTranslation("project");
	const setRenamingSessionPath = useSetAtom(renamingSessionPathAtom);

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

	return {
		labels: {
			rename: t("contextMenu.rename"),
			openInFolder: isMac ? t("contextMenu.openInFinder") : t("contextMenu.openInExplorer"),
			delete: t("contextMenu.delete"),
		},
		onClose,
		onDelete: handleDelete,
		onOpenInFolder: handleOpenInFolder,
		onRename: handleRename,
	};
}
