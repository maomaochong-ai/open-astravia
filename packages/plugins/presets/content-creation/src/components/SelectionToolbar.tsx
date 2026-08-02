import { NodeToolbar, Position } from "@xyflow/react";
import { useTranslation } from "@vetta-org/plugin-sdk";
import type { ChangeEvent } from "react";
import type { ContentNodeAlignment, ContentNodeLayout } from "../domain/node-layout";
import { DuplicateIcon, LockIcon, TrashIcon, UnlockIcon } from "./icons";

interface SelectionToolbarProps {
	nodeIds: readonly string[];
	allLocked: boolean;
	onAlign: (alignment: ContentNodeAlignment) => void;
	onLayout: (layout: ContentNodeLayout) => void;
	onDuplicate: () => void;
	onDelete: () => void;
	onToggleLock: () => void;
}

export function SelectionToolbar({
	nodeIds,
	allLocked,
	onAlign,
	onLayout,
	onDuplicate,
	onDelete,
	onToggleLock,
}: SelectionToolbarProps) {
	const { t } = useTranslation();
	const handleAlignment = (event: ChangeEvent<HTMLSelectElement>) => {
		if (event.target.value) onAlign(event.target.value as ContentNodeAlignment);
	};

	return (
		<NodeToolbar nodeId={[...nodeIds]} isVisible={nodeIds.length > 1} position={Position.Top} offset={12}>
			<div className="flex items-center gap-1 rounded-lg border border-border bg-popover p-1 text-xs text-popover-foreground shadow-lg nodrag nowheel" onPointerDown={(event) => event.stopPropagation()}>
				<span className="px-2 text-muted-foreground">{t("selection.count", { count: nodeIds.length })}</span>
				<select className="h-7 rounded border border-border bg-background px-1 text-xs" value="" aria-label={t("selection.align")} onChange={handleAlignment}>
					<option value="" disabled>{t("selection.align")}</option>
					<option value="left">{t("selection.align.left")}</option>
					<option value="center-x">{t("selection.align.centerX")}</option>
					<option value="right">{t("selection.align.right")}</option>
					<option value="top">{t("selection.align.top")}</option>
					<option value="center-y">{t("selection.align.centerY")}</option>
					<option value="bottom">{t("selection.align.bottom")}</option>
				</select>
				<button className="rounded px-2 py-1 hover:bg-accent" type="button" onClick={() => onLayout("row")}>{t("selection.layout.row")}</button>
				<button className="rounded px-2 py-1 hover:bg-accent" type="button" onClick={() => onLayout("column")}>{t("selection.layout.column")}</button>
				<button className="rounded px-2 py-1 hover:bg-accent" type="button" onClick={() => onLayout("grid")}>{t("selection.layout.grid")}</button>
				<button className="rounded p-1 hover:bg-accent" type="button" onClick={onToggleLock} title={t(allLocked ? "action.unlockNodes" : "action.lockNodes")}>
					{allLocked ? <UnlockIcon /> : <LockIcon />}
				</button>
				<button className="rounded p-1 hover:bg-accent" type="button" onClick={onDuplicate} title={t("action.duplicateNodes")}><DuplicateIcon /></button>
				<button className="rounded p-1 text-destructive hover:bg-destructive/10" type="button" onClick={onDelete} title={t("action.deleteNodes")}><TrashIcon /></button>
			</div>
		</NodeToolbar>
	);
}
