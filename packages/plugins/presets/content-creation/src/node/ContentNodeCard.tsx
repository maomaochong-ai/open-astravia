import { NodeResizer, NodeToolbar, Position, type Node, type NodeProps } from "@xyflow/react";
import { useTranslation } from "@vetta-org/plugin-sdk";
import { Button } from "@vetta/ui";
import { memo, useEffect, useRef, useState } from "react";
import { getContentNodeDefinition } from "./definitions";
import type {
	AssetKind,
	CanvasPosition,
	ContentAsset,
	ContentNodeData,
	ContentNodeInputBinding,
	ContentNodeKind,
	ContentNodeStatus,
	GenerationJob,
} from "../project/types";
import type { ContentModelDescriptor, ImportedContentReference } from "../generation/types";
import { useContentCanvasSelectionCount } from "../canvas/ContentCanvasSelectionContext";
import { ContentNodeHeader } from "./ContentNodeHeader";
import { ContentNodeHandle } from "./ContentNodeHandle";
import { ContentNodeSurface } from "./ContentNodeSurface";
import { DuplicateIcon, LockIcon, TrashIcon, UnlockIcon } from "../shared/icons";
import { ContentNodeEditor } from "./ContentNodeEditor";

export interface ContentFlowNodeData extends Record<string, unknown> {
	kind: ContentNodeKind;
	nodeData: ContentNodeData;
	assetUrl?: string;
	assetKind?: AssetKind;
	status: ContentNodeStatus;
	job?: GenerationJob;
	locked: boolean;
	models: readonly ContentModelDescriptor[];
	referenceAssets: readonly { binding: ContentNodeInputBinding; asset: ContentAsset }[];
	hasGenerationError: boolean;
	onDelete: () => void;
	onDuplicate: () => void;
	onToggleLock: () => void;
	onUpdate: (data: ContentNodeData) => Promise<void>;
	onResize: (position: CanvasPosition, width: number, height: number) => void;
	onRunNode: () => Promise<void>;
	onImportReferences: (files: readonly ImportedContentReference[]) => Promise<void>;
	onAddToTimeline?: () => Promise<void>;
}

export type ContentFlowNode = Node<ContentFlowNodeData, "contentNode">;

const CATEGORY_ACCENT: Record<string, string> = {
	input: "before:bg-muted-foreground/40",
	generation: "before:bg-primary",
	resource: "before:bg-amber-500",
	output: "before:bg-emerald-500",
};

/** Match bottom composer gap (`mt-2` = 8px) so top actions sit equally close to the card. */
const QUICK_TOOLBAR_OFFSET = 8;

export const ContentNodeCard = memo(function ContentNodeCard({ data, selected }: NodeProps<ContentFlowNode>) {
	const { t } = useTranslation();
	const selectionCount = useContentCanvasSelectionCount();
	const hoverLeaveTimerRef = useRef<number | null>(null);
	const [hovered, setHovered] = useState(false);
	const definition = getContentNodeDefinition(data.kind);
	const title = data.nodeData.label?.trim() || t(`node.kind.${data.kind}`);
	const singleSelection = selected && selectionCount === 1;
	const showQuickToolbar = singleSelection || (hovered && selectionCount === 0);
	const isResizable = !data.locked && (definition.category === "generation" || definition.category === "resource");
	const showEditor = singleSelection && definition.properties.length > 0;

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
			{/* Hide identity header while the action bar is open so they don't stack with a large gap. */}
			{showQuickToolbar ? null : (
				<ContentNodeHeader
					kind={data.kind}
					title={title}
					status={data.status}
					locked={data.locked}
					active={hovered || selected}
				/>
			)}
			<NodeResizer
				isVisible={singleSelection && isResizable}
				minWidth={220}
				minHeight={150}
				keepAspectRatio={false}
				onResizeEnd={(_, size) => data.onResize({ x: size.x, y: size.y }, size.width, size.height)}
			/>
			<NodeToolbar isVisible={showQuickToolbar} position={Position.Top} offset={QUICK_TOOLBAR_OFFSET}>
				<div
					className="flex items-center gap-0.5 rounded-lg border border-border/80 bg-popover/95 p-0.5 text-popover-foreground shadow-sm backdrop-blur-md"
					onMouseEnter={keepQuickToolbar}
					onMouseLeave={scheduleQuickToolbarClose}
				>
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
			{definition.inputs.length > 0 ? (
				<ContentNodeHandle
					label={definition.inputs.map((port) => t(port.labelKey)).join(", ")}
					side="left"
					active={hovered || selected}
				/>
			) : null}
			{definition.outputs.length > 0 ? (
				<ContentNodeHandle
					label={definition.outputs.map((port) => t(port.labelKey)).join(", ")}
					side="right"
					active={hovered || selected}
				/>
			) : null}
			<NodeToolbar isVisible={showEditor} position={Position.Bottom} offset={QUICK_TOOLBAR_OFFSET}>
				<div className="max-w-[calc(100vw-32px)]">
					<ContentNodeEditor
						kind={data.kind}
						status={data.status}
						data={data.nodeData}
						properties={definition.properties}
						models={data.models}
						referenceAssets={data.referenceAssets}
						hasGenerationError={data.hasGenerationError}
						onUpdate={data.onUpdate}
						onRunNode={data.onRunNode}
						onImportReferences={data.onImportReferences}
						onAddToTimeline={data.onAddToTimeline}
					/>
				</div>
			</NodeToolbar>
		</div>
	);
});
