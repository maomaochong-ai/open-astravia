import { useTranslation } from "@vetta-org/plugin-sdk";
import { Button } from "@vetta/ui";
import type { ReactNode } from "react";
import { DuplicateIcon, LockIcon, TrashIcon, UnlockIcon } from "../shared/icons";

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
		<Button
			type="button"
			variant="ghost"
			size="sm"
			className="w-full justify-start gap-2 px-2 font-normal"
			onClick={onSelect}
		>
			<span className="[&_svg]:size-3.5">{icon}</span>
			<span>{label}</span>
		</Button>
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
			className="absolute z-30 flex w-[196px] flex-col gap-0.5 rounded-xl border border-border bg-popover p-1 text-popover-foreground shadow-lg nodrag nowheel"
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
			className="absolute z-30 flex w-[196px] flex-col gap-0.5 rounded-xl border border-border bg-popover p-1 text-popover-foreground shadow-lg nodrag nowheel"
			style={{ left, top }}
			onPointerDown={(event) => event.stopPropagation()}
		>
			<ContextAction label={t("action.deleteConnection")} icon={<TrashIcon />} onSelect={onDelete} />
		</div>
	);
}
