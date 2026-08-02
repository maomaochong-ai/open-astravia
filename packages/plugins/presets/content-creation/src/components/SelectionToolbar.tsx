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
			<div className="content-creation-selection-toolbar nodrag nowheel" onPointerDown={(event) => event.stopPropagation()}>
				<span>{t("selection.count", { count: nodeIds.length })}</span>
				<select value="" aria-label={t("selection.align")} onChange={handleAlignment}>
					<option value="" disabled>{t("selection.align")}</option>
					<option value="left">{t("selection.align.left")}</option>
					<option value="center-x">{t("selection.align.centerX")}</option>
					<option value="right">{t("selection.align.right")}</option>
					<option value="top">{t("selection.align.top")}</option>
					<option value="center-y">{t("selection.align.centerY")}</option>
					<option value="bottom">{t("selection.align.bottom")}</option>
				</select>
				<button type="button" onClick={() => onLayout("row")}>{t("selection.layout.row")}</button>
				<button type="button" onClick={() => onLayout("column")}>{t("selection.layout.column")}</button>
				<button type="button" onClick={() => onLayout("grid")}>{t("selection.layout.grid")}</button>
				<button type="button" onClick={onToggleLock} title={t(allLocked ? "action.unlockNodes" : "action.lockNodes")}>
					{allLocked ? <UnlockIcon /> : <LockIcon />}
				</button>
				<button type="button" onClick={onDuplicate} title={t("action.duplicateNodes")}><DuplicateIcon /></button>
				<button type="button" onClick={onDelete} title={t("action.deleteNodes")}><TrashIcon /></button>
			</div>
		</NodeToolbar>
	);
}
