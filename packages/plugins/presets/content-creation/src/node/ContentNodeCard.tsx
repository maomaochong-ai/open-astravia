import { NodeResizer, NodeToolbar, Position, type Node, type NodeProps } from "@xyflow/react";
import { useTranslation } from "@vetta-org/plugin-sdk";
import { Button } from "@vetta/ui";
import { memo, useEffect, useRef, useState } from "react";
import { getContentNodeDefinition } from "./definitions";
import type {
	AssetKind,
	CanvasPosition,
	ContentNodeData,
	ContentNodeKind,
	ContentNodeStatus,
	GenerationJob,
} from "../project/types";
import type { ContentModelDescriptor } from "../generation/types";
import { useContentCanvasSelectionCount } from "../canvas/ContentCanvasSelectionContext";
import { ContentNodeHeader } from "./ContentNodeHeader";
import { ContentNodePort } from "./ContentNodePort";
import { ContentNodeSurface } from "./ContentNodeSurface";
import { DuplicateIcon, LockIcon, TrashIcon, UnlockIcon } from "../shared/icons";
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

const CATEGORY_ACCENT: Record<string, string> = {
	input: "before:bg-muted-foreground/40",
	generation: "before:bg-primary",
	resource: "before:bg-amber-500",
	output: "before:bg-emerald-500",
};

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
	const showComposer = singleSelection && definition.properties.length > 0;

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
			className="group relative h-full w-full overflow-visible"
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
				keepAspectRatio={false}
				onResizeEnd={(_, size) => data.onResize({ x: size.x, y: size.y }, size.width, size.height)}
			/>
			<NodeToolbar isVisible={showQuickToolbar} position={Position.Top} offset={34}>
				<div
					className="flex items-center gap-0.5 rounded-xl border border-border/80 bg-popover/95 p-1 text-popover-foreground shadow-md backdrop-blur-md"
					onMouseEnter={keepQuickToolbar}
					onMouseLeave={scheduleQuickToolbarClose}
				>
					<input
						className="nodrag nowheel max-w-[168px] truncate border-0 bg-transparent px-2 text-[11px] font-medium text-foreground outline-none placeholder:text-muted-foreground"
						value={titleDraft}
						placeholder={title}
						aria-label={t("action.renameNode")}
						onChange={(event) => setTitleDraft(event.target.value)}
						onBlur={() => void data.onUpdate({ ...data.nodeData, label: titleDraft.trim() || undefined })}
					/>
					<span className="mx-0.5 h-4 w-px bg-border" />
					<Button
						type="button"
						size="icon-xs"
						variant="ghost"
						className="nodrag"
						onClick={data.onToggleLock}
						title={t(data.locked ? "action.unlockNode" : "action.lockNode")}
					>
						{data.locked ? <UnlockIcon /> : <LockIcon />}
					</Button>
					<Button
						type="button"
						size="icon-xs"
						variant="ghost"
						className="nodrag"
						onClick={data.onDuplicate}
						title={t("action.duplicateNode")}
					>
						<DuplicateIcon />
					</Button>
					<Button
						type="button"
						size="icon-xs"
						variant="ghost"
						className="nodrag"
						onClick={data.onDelete}
						title={t("action.deleteNode")}
					>
						<TrashIcon />
					</Button>
				</div>
			</NodeToolbar>
			<div
				className={`relative z-0 h-full w-full overflow-hidden rounded-xl border bg-card text-card-foreground shadow-sm transition-[border-color,box-shadow] duration-150 before:absolute before:inset-x-0 before:top-0 before:z-10 before:h-0.5 before:content-[''] ${
					CATEGORY_ACCENT[definition.category] ?? ""
				} ${
					selected
						? "border-primary/45 shadow-[0_0_0_1px_color-mix(in_srgb,var(--primary)_28%,transparent),0_12px_28px_color-mix(in_srgb,black_12%,transparent)]"
						: "border-border/70 hover:border-border"
				} ${data.locked ? "opacity-90" : ""}`}
			>
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
			{definition.inputs.map((port, index) => (
				<ContentNodePort
					key={port.id}
					id={port.id}
					label={t(port.labelKey)}
					dataType={port.dataType}
					side="left"
					index={index}
					active={hovered || selected}
				/>
			))}
			{definition.outputs.map((port, index) => (
				<ContentNodePort
					key={port.id}
					id={port.id}
					label={t(port.labelKey)}
					dataType={port.dataType}
					side="right"
					index={index}
					active={hovered || selected}
				/>
			))}
			{showComposer ? (
				<div className="absolute inset-x-0 top-full z-20 mt-2">
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
				</div>
			) : null}
		</div>
	);
});
