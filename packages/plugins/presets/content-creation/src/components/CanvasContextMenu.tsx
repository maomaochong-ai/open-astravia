import { useTranslation } from "@vetta-org/plugin-sdk";
import type { ReactNode } from "react";
import { DuplicateIcon, LockIcon, TrashIcon, UnlockIcon } from "./icons";

interface NodeCanvasContextMenuProps {
	left: number;
	top: number;
	locked: boolean;
	onDuplicate: () => void;
	onToggleLock: () => void;
	onDelete: () => void;
}

function ContextAction({ label, icon, onSelect }: { label: string; icon: ReactNode; onSelect: () => void }) {
	return (
		<button type="button" onClick={onSelect}>
			{icon}
			<span>{label}</span>
		</button>
	);
}

export function NodeCanvasContextMenu({
	left,
	top,
	locked,
	onDuplicate,
	onToggleLock,
	onDelete,
}: NodeCanvasContextMenuProps) {
	const { t } = useTranslation();
	return (
		<div
			className="content-creation-context-menu nodrag nowheel"
			style={{ left, top }}
			onPointerDown={(event) => event.stopPropagation()}
		>
			<ContextAction label={t("action.duplicateNode")} icon={<DuplicateIcon />} onSelect={onDuplicate} />
			<ContextAction
				label={t(locked ? "action.unlockNode" : "action.lockNode")}
				icon={locked ? <UnlockIcon /> : <LockIcon />}
				onSelect={onToggleLock}
			/>
			<ContextAction label={t("action.deleteNode")} icon={<TrashIcon />} onSelect={onDelete} />
		</div>
	);
}

interface EdgeCanvasContextMenuProps {
	left: number;
	top: number;
	onDelete: () => void;
}

export function EdgeCanvasContextMenu({ left, top, onDelete }: EdgeCanvasContextMenuProps) {
	const { t } = useTranslation();
	return (
		<div
			className="content-creation-context-menu nodrag nowheel"
			style={{ left, top }}
			onPointerDown={(event) => event.stopPropagation()}
		>
			<ContextAction label={t("action.deleteConnection")} icon={<TrashIcon />} onSelect={onDelete} />
		</div>
	);
}
