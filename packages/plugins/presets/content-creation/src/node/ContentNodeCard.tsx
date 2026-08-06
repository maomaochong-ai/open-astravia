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
import { isImportedMediaFile, readImportedMediaFile } from "./readImportedMediaFile";

export interface ContentFlowNodeData extends Record<string, unknown> {
	kind: ContentNodeKind;
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
	onUpdate: (data: ContentNodeData) => Promise<void>;
	onResize: (position: CanvasPosition, width: number, height: number) => void;
	onRunNode: () => Promise<void>;
	onImportAssets: (files: readonly ImportedContentAsset[]) => Promise<void>;
	onImportReferences: (files: readonly ImportedContentReference[]) => Promise<void>;
	onAddToTimeline?: () => Promise<void>;
}

export type ContentFlowNode = Node<ContentFlowNodeData, "contentNode">;

/** Match bottom composer gap (`mt-2` = 8px) so top actions sit equally close to the card. */
const QUICK_TOOLBAR_OFFSET = 8;
const DROP_IMPORT_BATCH_SIZE = 4;

export const ContentNodeCard = memo(function ContentNodeCard({ data, selected }: NodeProps<ContentFlowNode>) {
	const { t } = useTranslation();
	const selectionCount = useContentCanvasSelectionCount();
	const hoverLeaveTimerRef = useRef<number | null>(null);
	const dragDepthRef = useRef(0);
	const [hovered, setHovered] = useState(false);
	const [dropActive, setDropActive] = useState(false);
	const [importingDrop, setImportingDrop] = useState(false);
	const [focusPromptRequest, setFocusPromptRequest] = useState(0);
	const definition = getContentNodeDefinition(data.kind);
	const title = data.nodeData.label?.trim() || t(`node.kind.${data.kind}`);
	const singleSelection = selected && selectionCount === 1;
	const showQuickToolbar = singleSelection || (hovered && selectionCount === 0);
	const isResizable = !data.locked && (definition.category === "generation" || definition.category === "resource");
	const showEditor = singleSelection && definition.properties.length > 0;
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
		data.kind === "asset" && event.dataTransfer.types.includes("Files");
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
		if (data.kind !== "asset") return;
		event.preventDefault();
		event.stopPropagation();
		dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
		if (dragDepthRef.current === 0) setDropActive(false);
	};
	const handleDrop = async (event: DragEvent<HTMLDivElement>) => {
		if (data.kind !== "asset") return;
		event.preventDefault();
		event.stopPropagation();
		dragDepthRef.current = 0;
		setDropActive(false);
		const files = Array.from(event.dataTransfer.files).filter(isImportedMediaFile);
		if (files.length === 0) return;
		setImportingDrop(true);
		try {
			for (let index = 0; index < files.length; index += DROP_IMPORT_BATCH_SIZE) {
				const batch = files.slice(index, index + DROP_IMPORT_BATCH_SIZE);
				await data.onImportAssets(await Promise.all(batch.map(readImportedMediaFile)));
			}
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
				{data.kind === "asset" && (dropActive || importingDrop) ? (
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
				<div className="max-w-[calc(100vw-32px)]">
					<ContentNodeEditor
						kind={data.kind}
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
						onRunNode={data.onRunNode}
						onImportAssets={data.onImportAssets}
						onImportReferences={data.onImportReferences}
						onAddToTimeline={data.onAddToTimeline}
					/>
				</div>
			</NodeToolbar>
		</div>
	);
});
