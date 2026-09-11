import type { JSX } from "react";
import { ContextMenuView, type ContextMenuNode } from "../shared/ContextMenuView";

export interface SessionContextMenuViewLabels {
	pin: string;
	rename: string;
	openInFolder: string;
	delete: string;
}

export interface SessionContextMenuViewProps {
	canDelete: boolean;
	canRename: boolean;
	labels: SessionContextMenuViewLabels;
	/** 挂在「重命名」之后的附加节点，例如标签二级菜单。 */
	extraItems?: readonly ContextMenuNode[];
	onClose: () => void;
	onDelete: () => void;
	onOpenInFolder: () => void;
	onRename: () => void;
	onTogglePin: () => void;
	x: number;
	y: number;
}

export function SessionContextMenuView({
	canDelete,
	canRename,
	labels,
	extraItems,
	onClose,
	onDelete,
	onOpenInFolder,
	onRename,
	onTogglePin,
	x,
	y,
}: SessionContextMenuViewProps): JSX.Element {
	const items: ContextMenuNode[] = [
		{ kind: "item", id: "pin", label: labels.pin, iconClassName: "icon-[solar--pin-linear]", onSelect: onTogglePin },
	];
	if (canRename) {
		items.push({
			kind: "item",
			id: "rename",
			label: labels.rename,
			iconClassName: "icon-[solar--pen-2-linear]",
			onSelect: onRename,
		});
	}
	if (extraItems && extraItems.length > 0) items.push(...extraItems);
	items.push({
		kind: "item",
		id: "open-in-folder",
		label: labels.openInFolder,
		iconClassName: "icon-[solar--folder-open-linear]",
		onSelect: onOpenInFolder,
	});
	if (canDelete) {
		items.push({
			kind: "item",
			id: "delete",
			label: labels.delete,
			iconClassName: "icon-[solar--trash-bin-trash-linear]",
			danger: true,
			onSelect: onDelete,
		});
	}

	return <ContextMenuView items={items} onClose={onClose} x={x} y={y} />;
}
