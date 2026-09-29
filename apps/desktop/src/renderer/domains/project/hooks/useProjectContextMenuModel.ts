import type { Project } from "@shared/store/atoms";
import { isSshProjectUri } from "@vetta/ssh-transport/project-uri";
import type { ProjectContextMenuViewProps } from "@vetta-org/theme-ui/project";
import { useCallback } from "react";
import { useTranslation } from "react-i18next";

const isMac = navigator.platform.toUpperCase().includes("MAC");

interface UseProjectContextMenuModelArgs {
	clearClawDisabled?: boolean;
	clearConversationDisabled?: boolean;
	defaultScope?: "conversation" | "claw";
	onArchive: (cwd: string) => void;
	onClearClaw?: (cwd: string) => void;
	onClearConversation?: (cwd: string) => void;
	onClose: () => void;
	onRemove: (cwd: string) => void;
	onOpenClawSettings?: () => void;
	project: Project;
}

export function useProjectContextMenuModel({
	clearClawDisabled,
	clearConversationDisabled,
	defaultScope,
	onArchive,
	onClearClaw,
	onClearConversation,
	onClose,
	onRemove,
	onOpenClawSettings,
	project,
}: UseProjectContextMenuModelArgs): Omit<ProjectContextMenuViewProps, "x" | "y"> {
	const { t } = useTranslation("project");
	const cwd = project.cwd;

	const handleArchive = useCallback(() => {
		onArchive(cwd);
		onClose();
	}, [cwd, onArchive, onClose]);

	const handleClearClaw = useCallback(() => {
		onClearClaw?.(cwd);
		onClose();
	}, [cwd, onClearClaw, onClose]);

	const handleClearConversation = useCallback(() => {
		onClearConversation?.(cwd);
		onClose();
	}, [cwd, onClearConversation, onClose]);

	const handleRemove = useCallback(() => {
		onRemove(cwd);
		onClose();
	}, [cwd, onClose, onRemove]);

	const handleOpenClawSettings = useCallback(() => {
		onOpenClawSettings?.();
		onClose();
	}, [onClose, onOpenClawSettings]);

	const handleOpenInFolder = useCallback(() => {
		void window.vetta.shell.showInFolder(cwd);
		onClose();
	}, [cwd, onClose]);

	return {
		// 远程项目在这台电脑上没有对应的位置，系统文件管理器无从显示。
		canOpenInFolder: !isSshProjectUri(cwd),
		clearClawDisabled,
		clearConversationDisabled,
		defaultScope,
		isDefault: project.isDefault === true,
		labels: {
			openInFolder: isMac ? t("contextMenu.openInFinder") : t("contextMenu.openInExplorer"),
			archiveProject: t("contextMenu.archiveProject"),
			removeFromList: t("contextMenu.removeFromList"),
			clearConversation: t("contextMenu.clearConversation"),
			clearConversationDisabled: t("contextMenu.clearConversationDisabled"),
			clearClaw: t("contextMenu.clearClaw"),
			clearClawDisabled: t("contextMenu.clearClawDisabled"),
			clawSettings: t("contextMenu.clawSettings"),
		},
		onArchive: handleArchive,
		onClearClaw: onClearClaw ? handleClearClaw : undefined,
		onClearConversation: onClearConversation ? handleClearConversation : undefined,
		onClose,
		onOpenClawSettings: onOpenClawSettings ? handleOpenClawSettings : undefined,
		onOpenInFolder: handleOpenInFolder,
		onRemove: handleRemove,
	};
}
