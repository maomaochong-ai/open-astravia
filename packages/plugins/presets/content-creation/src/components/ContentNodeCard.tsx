import { Handle, NodeResizer, NodeToolbar, Position, type Node, type NodeProps } from "@xyflow/react";
import { useTranslation } from "@vetta-org/plugin-sdk";
import { memo, useEffect, useRef, useState } from "react";
import { getContentNodeDefinition } from "../domain/node-definitions";
import type {
	AssetKind,
	CanvasPosition,
	ContentNodeData,
	ContentNodeKind,
	ContentNodeStatus,
	GenerationJob,
} from "../domain/model";
import type { ContentModelDescriptor } from "../generation/types";
import { useContentCanvasSelectionCount } from "./ContentCanvasSelectionContext";
import { ContentNodeHeader } from "./ContentNodeHeader";
import { ContentNodeSurface } from "./ContentNodeSurface";
import { DuplicateIcon, LockIcon, TrashIcon, UnlockIcon } from "./icons";
import { NodeGenerationComposer } from "./NodeGenerationComposer";

export interface ContentFlowNodeData extends Record<string, unknown> {
	kind: ContentNodeKind;
	nodeData: ContentNodeData;
	assetUrl?: string;
	assetKind?: AssetKind;
	status: ContentNodeStatus;
	job?: GenerationJob;
	locked: boolean;
	models: readonly ContentModelDescriptor[];
	hasGenerationError: boolean;
	onDelete: () => void;
	onDuplicate: () => void;
	onToggleLock: () => void;
	onUpdate: (data: ContentNodeData) => Promise<void>;
	onResize: (position: CanvasPosition, width: number, height: number) => void;
	onRunNode: () => Promise<void>;
	onAddToTimeline?: () => Promise<void>;
}

export type ContentFlowNode = Node<ContentFlowNodeData, "contentNode">;

export const ContentNodeCard = memo(function ContentNodeCard({ data, selected }: NodeProps<ContentFlowNode>) {
	const { t } = useTranslation();
	const selectionCount = useContentCanvasSelectionCount();
	const hoverLeaveTimerRef = useRef<number | null>(null);
	const [hovered, setHovered] = useState(false);
	const definition = getContentNodeDefinition(data.kind);
	const title = data.nodeData.label?.trim() || t(`node.kind.${data.kind}`);
	const [titleDraft, setTitleDraft] = useState(data.nodeData.label ?? "");
	const singleSelection = selected && selectionCount === 1;
	const showQuickToolbar = singleSelection || (hovered && selectionCount === 0);
	const isResizable = !data.locked && (definition.category === "generation" || definition.category === "resource");

	useEffect(() => setTitleDraft(data.nodeData.label ?? ""), [data.nodeData.label]);
	useEffect(
		() => () => {
			if (hoverLeaveTimerRef.current !== null) window.clearTimeout(hoverLeaveTimerRef.current);
		},
		[],
	);

	const keepQuickToolbar = () => {
		if (hoverLeaveTimerRef.current !== null) window.clearTimeout(hoverLeaveTimerRef.current);
		hoverLeaveTimerRef.current = null;
		setHovered(true);
	};
	const scheduleQuickToolbarClose = () => {
		if (hoverLeaveTimerRef.current !== null) window.clearTimeout(hoverLeaveTimerRef.current);
		hoverLeaveTimerRef.current = window.setTimeout(() => setHovered(false), 120);
	};

	return (
		<div
			className="group relative"
			onMouseEnter={keepQuickToolbar}
			onMouseLeave={scheduleQuickToolbarClose}
		>
			<ContentNodeHeader
				kind={data.kind}
				title={title}
				status={data.status}
				locked={data.locked}
				active={hovered || selected}
			/>
			<NodeResizer
				isVisible={singleSelection && isResizable}
				minWidth={220}
				minHeight={150}
				keepAspectRatio
				onResizeEnd={(_, size) => data.onResize({ x: size.x, y: size.y }, size.width, size.height)}
			/>
			<NodeToolbar isVisible={showQuickToolbar} position={Position.Top} offset={30}>
				<div className="flex items-center gap-1 rounded-lg border border-border bg-popover p-1 shadow-lg" onMouseEnter={keepQuickToolbar} onMouseLeave={scheduleQuickToolbarClose}>
					<input
						className="nodrag nowheel h-7 w-[180px] rounded border border-border bg-background px-2 text-xs outline-none focus:ring-1 focus:ring-ring"
						value={titleDraft}
						placeholder={title}
						aria-label={t("action.renameNode")}
						onChange={(event) => setTitleDraft(event.target.value)}
						onBlur={() => void data.onUpdate({ ...data.nodeData, label: titleDraft.trim() || undefined })}
					/>
					<button
						type="button"
						className="nodrag rounded p-1.5 hover:bg-accent"
						onClick={data.onToggleLock}
						title={t(data.locked ? "action.unlockNode" : "action.lockNode")}
					>
						{data.locked ? <UnlockIcon /> : <LockIcon />}
					</button>
					<button type="button" className="nodrag rounded p-1.5 hover:bg-accent" onClick={data.onDuplicate} title={t("action.duplicateNode")}>
						<DuplicateIcon />
					</button>
					<button type="button" className="nodrag rounded p-1.5 text-destructive hover:bg-destructive/10" onClick={data.onDelete} title={t("action.deleteNode")}>
						<TrashIcon />
					</button>
				</div>
			</NodeToolbar>
			{definition.inputs.map((port, index) => (
				<div key={port.id} className={`pointer-events-none absolute right-full z-10 flex h-10 w-[52px] -translate-y-1/2 items-center justify-end gap-1 text-[9px] text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 ${selected ? "opacity-100" : ""}`} style={{ top: `${((index + 1) / (definition.inputs.length + 1)) * 100}%` }}>
					<Handle className="pointer-events-auto h-9 w-9 rounded-full border-0 bg-transparent" type="target" id={port.id} position={Position.Left} />
					<span className="max-w-[44px] truncate">{t(port.labelKey)}</span>
				</div>
			))}
			<div className={`relative h-full w-full overflow-hidden rounded-[14px] border border-border/70 bg-card/95 text-card-foreground shadow-lg transition-[border-color,box-shadow] ${selected ? "border-primary shadow-xl ring-1 ring-primary/30" : ""} ${data.locked ? "opacity-80" : ""}`}>
				<ContentNodeSurface
					kind={data.kind}
					status={data.status}
					data={data.nodeData}
					descriptionKey={definition.descriptionKey}
					assetUrl={data.assetUrl}
					assetKind={data.assetKind}
					job={data.job}
				/>
			</div>
			<NodeToolbar isVisible={singleSelection && definition.properties.length > 0} position={Position.Bottom} offset={10}>
				<NodeGenerationComposer
					kind={data.kind}
					status={data.status}
					data={data.nodeData}
					properties={definition.properties}
					models={data.models}
					hasGenerationError={data.hasGenerationError}
					onUpdate={data.onUpdate}
					onRunNode={data.onRunNode}
					onAddToTimeline={data.onAddToTimeline}
				/>
			</NodeToolbar>
			{definition.outputs.map((port, index) => (
				<div key={port.id} className={`pointer-events-none absolute left-full z-10 flex h-10 w-[52px] -translate-y-1/2 items-center justify-start gap-1 text-[9px] text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 ${selected ? "opacity-100" : ""}`} style={{ top: `${((index + 1) / (definition.outputs.length + 1)) * 100}%` }}>
					<span className="max-w-[44px] truncate">{t(port.labelKey)}</span>
					<Handle className="pointer-events-auto h-9 w-9 rounded-full border-0 bg-transparent" type="source" id={port.id} position={Position.Right} />
				</div>
			))}
		</div>
	);
});
