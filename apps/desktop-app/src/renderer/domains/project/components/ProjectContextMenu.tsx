import type { Project } from "@shared/store/atoms";
import { ProjectContextMenuView } from "@vetta/theme-ui/project";
import { createPortal } from "react-dom";
import { useProjectContextMenuModel } from "../hooks/useProjectContextMenuModel";

interface ProjectContextMenuProps {
	x: number;
	y: number;
	project: Project;
	onClose: () => void;
	onArchive: (cwd: string) => void;
	onRemove: (cwd: string) => void;
	onDelete: (cwd: string) => void;
	defaultScope?: "conversation" | "claw";
	onClearConversation?: (cwd: string) => void;
	onClearClaw?: (cwd: string) => void;
	onOpenClawSettings?: () => void;
	clearConversationDisabled?: boolean;
	clearClawDisabled?: boolean;
}

export function ProjectContextMenu({
	x,
	y,
	project,
	onClose,
	onArchive,
	onRemove,
	onDelete,
	defaultScope,
	onClearConversation,
	onClearClaw,
	onOpenClawSettings,
	clearConversationDisabled,
	clearClawDisabled,
}: ProjectContextMenuProps): JSX.Element {
	const model = useProjectContextMenuModel({
		project,
		onClose,
		onArchive,
		onRemove,
		onDelete,
		defaultScope,
		onClearConversation,
		onClearClaw,
		onOpenClawSettings,
		clearConversationDisabled,
		clearClawDisabled,
	});
	return createPortal(<ProjectContextMenuView {...model} x={x} y={y} />, document.body);
}
