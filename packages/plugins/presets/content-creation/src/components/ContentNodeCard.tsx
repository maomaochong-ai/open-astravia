import { Handle, NodeResizer, NodeToolbar, Position, type Node, type NodeProps } from "@xyflow/react";
import { useTranslation } from "@vetta-org/plugin-sdk";
import { getContentNodeDefinition } from "../domain/node-definitions";
import type { AssetKind, CanvasPosition, ContentNodeData, ContentNodeKind, ContentNodeStatus } from "../domain/model";
import type { ContentModelDescriptor } from "../generation/types";
import { ContentNodeSurface } from "./ContentNodeSurface";
import { DuplicateIcon, TrashIcon } from "./icons";
import { NodeGenerationComposer } from "./NodeGenerationComposer";

export interface ContentFlowNodeData extends Record<string, unknown> {
	kind: ContentNodeKind;
	nodeData: ContentNodeData;
	assetUrl?: string;
	assetKind?: AssetKind;
	status: ContentNodeStatus;
	models: readonly ContentModelDescriptor[];
	hasGenerationError: boolean;
	onDelete: () => void;
	onDuplicate: () => void;
	onUpdate: (data: ContentNodeData) => Promise<void>;
	onResize: (position: CanvasPosition, width: number, height: number) => void;
	onRunNode: () => Promise<void>;
	onAddToTimeline?: () => Promise<void>;
}

export type ContentFlowNode = Node<ContentFlowNodeData, "contentNode">;

export function ContentNodeCard({ data, selected }: NodeProps<ContentFlowNode>) {
	const { t } = useTranslation();
	const definition = getContentNodeDefinition(data.kind);
	const title = data.nodeData.label?.trim() || t(`node.kind.${data.kind}`);
	const isResizable = definition.category === "generation" || definition.category === "resource";

	return (
		<div className={`content-creation-node is-${definition.category} is-${data.kind} ${selected ? "is-selected" : ""}`}>
			<NodeResizer
				isVisible={selected && isResizable}
				minWidth={220}
				minHeight={150}
				keepAspectRatio
				onResizeEnd={(_, size) => data.onResize({ x: size.x, y: size.y }, size.width, size.height)}
			/>
			<NodeToolbar isVisible={selected} position={Position.Top} offset={8}>
				<div className="content-creation-node-toolbar">
					<span>{title}</span>
					<button type="button" className="nodrag" onClick={data.onDuplicate} title={t("action.duplicateNode")}>
						<DuplicateIcon />
					</button>
					<button type="button" className="nodrag" onClick={data.onDelete} title={t("action.deleteNode")}>
						<TrashIcon />
					</button>
				</div>
			</NodeToolbar>
			{definition.inputs.map((port, index) => (
				<div key={port.id} className="content-creation-port is-input" style={{ top: `${((index + 1) / (definition.inputs.length + 1)) * 100}%` }}>
					<Handle type="target" id={port.id} position={Position.Left} />
					{selected ? <span>{t(port.labelKey)}</span> : null}
				</div>
			))}
			<ContentNodeSurface
				kind={data.kind}
				status={data.status}
				data={data.nodeData}
				title={title}
				descriptionKey={definition.descriptionKey}
				assetUrl={data.assetUrl}
				assetKind={data.assetKind}
			/>
			<NodeToolbar isVisible={selected && definition.properties.length > 0} position={Position.Bottom} offset={10}>
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
				<div key={port.id} className="content-creation-port is-output" style={{ top: `${((index + 1) / (definition.outputs.length + 1)) * 100}%` }}>
					{selected ? <span>{t(port.labelKey)}</span> : null}
					<Handle type="source" id={port.id} position={Position.Right} />
				</div>
			))}
		</div>
	);
}
