import { NodeToolbar, Position } from "@xyflow/react";
import { useTranslation } from "@vetta-org/plugin-sdk";
import {
	Button,
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@vetta/ui";
import type { ContentNodeAlignment, ContentNodeLayout } from "../node/layout";
import { DuplicateIcon, LockIcon, TrashIcon, UnlockIcon } from "../shared/icons";

interface SelectionToolbarProps {
	nodeIds: readonly string[];
	allLocked: boolean;
	onAlign: (alignment: ContentNodeAlignment) => void;
	onLayout: (layout: ContentNodeLayout) => void;
	onDuplicate: () => void;
	onDelete: () => void;
	onToggleLock: () => void;
}

const ALIGNMENTS: readonly ContentNodeAlignment[] = [
	"left",
	"center-x",
	"right",
	"top",
	"center-y",
	"bottom",
];

const ALIGN_LABEL_KEY: Record<ContentNodeAlignment, string> = {
	left: "selection.align.left",
	"center-x": "selection.align.centerX",
	right: "selection.align.right",
	top: "selection.align.top",
	"center-y": "selection.align.centerY",
	bottom: "selection.align.bottom",
};

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

	return (
		<NodeToolbar nodeId={[...nodeIds]} isVisible={nodeIds.length > 1} position={Position.Top} offset={12}>
			<div
				className="flex items-center gap-0.5 rounded-xl border border-border/80 bg-popover/95 p-1 text-popover-foreground shadow-md backdrop-blur-md nodrag nowheel"
				onPointerDown={(event) => event.stopPropagation()}
			>
				<span className="whitespace-nowrap px-2 text-[11px] text-muted-foreground">
					{t("selection.count", { count: nodeIds.length })}
				</span>
				<span className="mx-0.5 h-4 w-px bg-border" />
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<Button type="button" size="xs" variant="ghost">
							{t("selection.align")}
						</Button>
					</DropdownMenuTrigger>
					<DropdownMenuContent align="start" className="z-[100] min-w-[9rem]">
						{ALIGNMENTS.map((alignment) => (
							<DropdownMenuItem key={alignment} onSelect={() => onAlign(alignment)}>
								{t(ALIGN_LABEL_KEY[alignment])}
							</DropdownMenuItem>
						))}
					</DropdownMenuContent>
				</DropdownMenu>
				<Button type="button" size="xs" variant="ghost" onClick={() => onLayout("row")}>
					{t("selection.layout.row")}
				</Button>
				<Button type="button" size="xs" variant="ghost" onClick={() => onLayout("column")}>
					{t("selection.layout.column")}
				</Button>
				<Button type="button" size="xs" variant="ghost" onClick={() => onLayout("grid")}>
					{t("selection.layout.grid")}
				</Button>
				<span className="mx-0.5 h-4 w-px bg-border" />
				<Button
					type="button"
					size="icon-xs"
					variant="ghost"
					onClick={onToggleLock}
					title={t(allLocked ? "action.unlockNodes" : "action.lockNodes")}
				>
					{allLocked ? <UnlockIcon /> : <LockIcon />}
				</Button>
				<Button type="button" size="icon-xs" variant="ghost" onClick={onDuplicate} title={t("action.duplicateNodes")}>
					<DuplicateIcon />
				</Button>
				<Button type="button" size="icon-xs" variant="ghost" onClick={onDelete} title={t("action.deleteNodes")}>
					<TrashIcon />
				</Button>
			</div>
		</NodeToolbar>
	);
}
