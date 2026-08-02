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
		<button type="button" className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-accent" onClick={onSelect}>
			<span className="h-4 w-4">{icon}</span>
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
			className="absolute z-50 min-w-[190px] rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-xl nodrag nowheel"
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
			className="absolute z-50 min-w-[190px] rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-xl nodrag nowheel"
			style={{ left, top }}
			onPointerDown={(event) => event.stopPropagation()}
		>
			<ContextAction label={t("action.deleteConnection")} icon={<TrashIcon />} onSelect={onDelete} />
		</div>
	);
}
