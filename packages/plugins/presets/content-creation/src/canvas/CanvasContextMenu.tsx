import { useTranslation } from "@vetta-org/plugin-sdk";
import { Button } from "@vetta/ui";
import type { ReactNode } from "react";

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
			<span className="grid size-3.5 shrink-0 place-items-center [&>*]:size-3.5">{icon}</span>
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
			<ContextAction
				label={t("action.duplicateNode")}
				icon={<span className="icon-[lucide--copy] block size-4 shrink-0" aria-hidden="true" />}
				onSelect={onDuplicate}
			/>
			<ContextAction
				label={t(locked ? "action.unlockNode" : "action.lockNode")}
				icon={
					locked ? (
						<span className="icon-[lucide--lock-open] block size-4 shrink-0" aria-hidden="true" />
					) : (
						<span className="icon-[lucide--lock] block size-4 shrink-0" aria-hidden="true" />
					)
				}
				onSelect={onToggleLock}
			/>
			<ContextAction
				label={t("action.deleteNode")}
				icon={<span className="icon-[lucide--trash-2] block size-4 shrink-0" aria-hidden="true" />}
				onSelect={onDelete}
			/>
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
			<ContextAction
				label={t("action.deleteConnection")}
				icon={<span className="icon-[lucide--trash-2] block size-4 shrink-0" aria-hidden="true" />}
				onSelect={onDelete}
			/>
		</div>
	);
}
