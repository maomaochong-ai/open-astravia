import { NodeResizer, NodeToolbar, Position, type Node, type NodeProps } from "@xyflow/react";
import { useTranslation } from "@vetta-org/plugin-sdk";
import { Button } from "@vetta/ui";
import { type DragEvent, memo, useEffect, useRef, useState } from "react";
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
import type {
	ContentModelDescriptor,
	ImportedContentAsset,
	ImportedContentReference,
} from "../generation/types";
import { useContentCanvasSelectionCount } from "../canvas/ContentCanvasSelectionContext";
import { ContentNodeHeader } from "./ContentNodeHeader";
import { ContentNodeHandle } from "./ContentNodeHandle";
import { ContentNodeSurface } from "./ContentNodeSurface";
import { ContentNodeEditor } from "./ContentNodeEditor";
import type { ConnectedContentAsset } from "./material-assets";
import type { ContentAssetReferenceCandidate } from "./reference-candidates";
import { resolveContentPrompt, type ConnectedPromptSource } from "./prompt-sources";
import { collectDroppedMediaFiles, dataTransferHasFiles, importDroppedMediaFiles } from "./dropped-media";
import { getContentNodeFileDropBehavior } from "./drop-behaviors";

export interface ContentFlowNodeData extends Record<string, unknown> {
	kind: ContentNodeKind;
	name: string;
	nodeData: ContentNodeData;
	assets: readonly ContentAsset[];
	connectedAssets: readonly ConnectedContentAsset[];
	connectedPrompts: readonly ConnectedPromptSource[];
	mentionAssets: readonly ContentAssetReferenceCandidate[];
	assetUrl?: string;
	assetKind?: AssetKind;
	status: ContentNodeStatus;
	job?: GenerationJob;
	locked: boolean;
	models: readonly ContentModelDescriptor[];
	referenceAssets: readonly { binding: ContentNodeInputBinding; asset: ContentAsset }[];
	onDelete: () => void;
	onDuplicate: () => void;
	onToggleLock: () => void;
	onRename: (name: string) => Promise<void>;
	onUpdate: (data: ContentNodeData) => Promise<void>;
	onResize: (position: CanvasPosition, width: number, height: number) => void;
	onRunNode: () => Promise<void>;
	onImportAssets: (files: readonly ImportedContentAsset[]) => Promise<void>;
	onImportReferences: (files: readonly ImportedContentReference[], slotId?: string) => Promise<void>;
	onAddToTimeline?: () => Promise<void>;
}

export type ContentFlowNode = Node<ContentFlowNodeData, "contentNode">;

/** Match bottom composer gap (`mt-2` = 8px) so top actions sit equally close to the card. */
const QUICK_TOOLBAR_OFFSET = 8;
const StableContentNodeEditor = memo(ContentNodeEditor);

function areContentNodeCardPropsEqual(
	previous: NodeProps<ContentFlowNode>,
	next: NodeProps<ContentFlowNode>,
) {
	return (
		previous.data === next.data &&
		previous.selected === next.selected &&
		previous.dragging === next.dragging
	);
}

export const ContentNodeCard = memo(function ContentNodeCard({ data, dragging, selected }: NodeProps<ContentFlowNode>) {
	const { t } = useTranslation();
	const selectionCount = useContentCanvasSelectionCount();
	const hoverLeaveTimerRef = useRef<number | null>(null);
	const dragDepthRef = useRef(0);
	const [hovered, setHovered] = useState(false);
	const [dropActive, setDropActive] = useState(false);
	const [importingDrop, setImportingDrop] = useState(false);
	const [focusPromptRequest, setFocusPromptRequest] = useState(0);
	const [editorMounted, setEditorMounted] = useState(false);
	const definition = getContentNodeDefinition(data.kind);
	const fileDropBehavior = getContentNodeFileDropBehavior(data.kind);
	const title = data.name || t(`node.kind.${data.kind}`);
	const singleSelection = selected && selectionCount === 1;
	const showQuickToolbar = singleSelection || (hovered && selectionCount === 0);
	const isResizable = !data.locked && (definition.category === "generation" || definition.category === "resource");
	const showEditor = singleSelection && editorMounted && definition.properties.length > 0;
	const inputLabel = definition.inputs.map((port) => t(port.labelKey)).join(", ");
	const outputLabel = definition.outputs.map((port) => t(port.labelKey)).join(", ");
	const surfaceData =
		data.kind === "image-generator" || data.kind === "video-generator"
			? { ...data.nodeData, prompt: resolveContentPrompt(data.connectedPrompts, data.nodeData) }
			: data.nodeData;

	useEffect(
		() => () => {
			if (hoverLeaveTimerRef.current !== null) window.clearTimeout(hoverLeaveTimerRef.current);
		},
		[],
	);
	useEffect(() => {
		if (!singleSelection) {
			setEditorMounted(false);
			return;
		}
		if (!dragging) setEditorMounted(true);
	}, [dragging, singleSelection]);

	const keepQuickToolbar = () => {
		if (hoverLeaveTimerRef.current !== null) window.clearTimeout(hoverLeaveTimerRef.current);
		hoverLeaveTimerRef.current = null;
		setHovered(true);
	};
	const scheduleQuickToolbarClose = () => {
		if (hoverLeaveTimerRef.current !== null) window.clearTimeout(hoverLeaveTimerRef.current);
		hoverLeaveTimerRef.current = window.setTimeout(() => setHovered(false), 120);
	};
	const acceptsFileDrop = (event: DragEvent<HTMLDivElement>) =>
		Boolean(fileDropBehavior) && dataTransferHasFiles(event.dataTransfer);
	const handleDragEnter = (event: DragEvent<HTMLDivElement>) => {
		if (!acceptsFileDrop(event)) return;
		event.preventDefault();
		event.stopPropagation();
		dragDepthRef.current += 1;
		setDropActive(true);
	};
	const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
		if (!acceptsFileDrop(event)) return;
		event.preventDefault();
		event.stopPropagation();
		event.dataTransfer.dropEffect = "copy";
	};
	const handleDragLeave = (event: DragEvent<HTMLDivElement>) => {
		if (!fileDropBehavior) return;
		event.preventDefault();
		event.stopPropagation();
		dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
		if (dragDepthRef.current === 0) setDropActive(false);
	};
	const handleDrop = async (event: DragEvent<HTMLDivElement>) => {
		if (fileDropBehavior?.action !== "append-assets") return;
		event.preventDefault();
		event.stopPropagation();
		dragDepthRef.current = 0;
		setDropActive(false);
		setImportingDrop(true);
		try {
			const files = await collectDroppedMediaFiles(event.dataTransfer);
			await importDroppedMediaFiles(files, data.onImportAssets);
		} finally {
			setImportingDrop(false);
		}
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
						{data.locked ? (
							<span className="icon-[lucide--lock-open] block size-4 shrink-0" aria-hidden="true" />
						) : (
							<span className="icon-[lucide--lock] block size-4 shrink-0" aria-hidden="true" />
						)}
					</Button>
					<Button
						type="button"
						size="icon-xs"
						variant="ghost"
						className="nodrag"
						onClick={data.onDuplicate}
						title={t("action.duplicateNode")}
					>
						<span className="icon-[lucide--copy] block size-4 shrink-0" aria-hidden="true" />
					</Button>
					<Button
						type="button"
						size="icon-xs"
						variant="ghost"
						className="nodrag"
						onClick={data.onDelete}
						title={t("action.deleteNode")}
					>
						<span className="icon-[lucide--trash-2] block size-4 shrink-0" aria-hidden="true" />
					</Button>
				</div>
			</NodeToolbar>
			<div
				className={`relative z-0 h-full w-full overflow-hidden rounded-xl border bg-card text-card-foreground shadow-sm transition-[border-color,box-shadow] duration-150 ${
					selected
						? "border-primary/45 shadow-[0_0_0_1px_color-mix(in_srgb,var(--primary)_28%,transparent),0_12px_28px_color-mix(in_srgb,black_12%,transparent)]"
						: "border-border/70 hover:border-border"
				} ${data.locked ? "opacity-90" : ""}`}
				onDragEnter={handleDragEnter}
				onDragOver={handleDragOver}
				onDragLeave={handleDragLeave}
				onDrop={(event) => void handleDrop(event)}
				onDoubleClick={(event) => {
					if (data.kind !== "prompt") return;
					event.stopPropagation();
					setFocusPromptRequest((current) => current + 1);
				}}
			>
				<ContentNodeSurface
					kind={data.kind}
					status={data.status}
					data={surfaceData}
					descriptionKey={definition.descriptionKey}
					assets={data.assets}
					referenceAssets={data.referenceAssets.map(({ asset }) => asset)}
					assetUrl={data.assetUrl}
					assetKind={data.assetKind}
					job={data.job}
				/>
				{fileDropBehavior?.action === "append-assets" && (dropActive || importingDrop) ? (
					<div className="pointer-events-none absolute inset-1 z-30 grid place-items-center rounded-lg border border-dashed border-primary/55 bg-background/90 text-center backdrop-blur-sm">
						<div className="flex flex-col items-center gap-2 px-4 text-xs font-medium text-foreground">
							<span className="icon-[lucide--file-down] block size-6 text-primary" aria-hidden="true" />
							<span>{t(importingDrop ? "assetNode.importing" : "assetNode.drop")}</span>
						</div>
					</div>
				) : null}
			</div>
			<ContentNodeHandle
				label={inputLabel || outputLabel}
				side="left"
				type={definition.inputs.length > 0 ? "target" : "source"}
				active={hovered || selected}
				selected={selected}
			/>
			<ContentNodeHandle
				label={outputLabel || inputLabel}
				side="right"
				type={definition.outputs.length > 0 ? "source" : "target"}
				active={hovered || selected}
				selected={selected}
			/>
			<NodeToolbar isVisible={showEditor} position={Position.Bottom} offset={QUICK_TOOLBAR_OFFSET}>
				<div
					className={`max-w-[calc(100vw-32px)] ${dragging ? "invisible pointer-events-none" : ""}`}
					aria-hidden={dragging || undefined}
				>
					<StableContentNodeEditor
						kind={data.kind}
						name={data.name}
						status={data.status}
						data={data.nodeData}
						properties={definition.properties}
						models={data.models}
						assets={data.assets}
						connectedAssets={data.connectedAssets}
						connectedPrompts={data.connectedPrompts}
						mentionAssets={data.mentionAssets}
						referenceAssets={data.referenceAssets}
						focusPromptRequest={focusPromptRequest}
						onUpdate={data.onUpdate}
						onRename={data.onRename}
						onRunNode={data.onRunNode}
						onImportAssets={data.onImportAssets}
						onImportReferences={data.onImportReferences}
						onAddToTimeline={data.onAddToTimeline}
					/>
				</div>
			</NodeToolbar>
		</div>
	);
}, areContentNodeCardPropsEqual);
