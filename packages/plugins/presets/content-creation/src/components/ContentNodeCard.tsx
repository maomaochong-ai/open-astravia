import { Handle, NodeToolbar, Position, type Node, type NodeProps } from "@xyflow/react";
import { useTranslation } from "@vetta-org/plugin-sdk";
import { getContentNodeDefinition } from "../domain/node-definitions";
import type { ContentNodeKind, ContentNodeStatus } from "../domain/model";
import { DuplicateIcon, TrashIcon } from "./icons";

export interface ContentFlowNodeData extends Record<string, unknown> {
	kind: ContentNodeKind;
	label: string;
	prompt?: string;
	assetUrl?: string;
	status: ContentNodeStatus;
	onDelete: () => void;
	onDuplicate: () => void;
}

export type ContentFlowNode = Node<ContentFlowNodeData, "contentNode">;

export function ContentNodeCard({ data, selected }: NodeProps<ContentFlowNode>) {
	const { t } = useTranslation();
	const definition = getContentNodeDefinition(data.kind);
	const title = data.label.trim() || t(`node.kind.${data.kind}`);

	return (
		<div className={`content-creation-node is-${definition.category} ${selected ? "is-selected" : ""}`}>
			<NodeToolbar isVisible={selected} position={Position.Top}>
				<div className="content-creation-node-toolbar">
					<button type="button" onClick={data.onDuplicate} title={t("action.duplicateNode")}>
						<DuplicateIcon />
					</button>
					<button type="button" onClick={data.onDelete} title={t("action.deleteNode")}>
						<TrashIcon />
					</button>
				</div>
			</NodeToolbar>
			{definition.inputs.map((port, index) => (
				<div key={port.id} className="content-creation-port is-input" style={{ top: 50 + index * 26 }}>
					<Handle type="target" id={port.id} position={Position.Left} />
					{selected ? <span>{t(port.labelKey)}</span> : null}
				</div>
			))}
			<div className="content-creation-node__header">
				<span className="content-creation-node__kind">{t(`node.kind.${data.kind}`)}</span>
				<span className={`content-creation-node__status is-${data.status}`}>{t(`node.status.${data.status}`)}</span>
			</div>
			<strong className="content-creation-node__title">{title}</strong>
			{data.assetUrl ? <img className="content-creation-node__preview" src={data.assetUrl} alt={t("node.generatedPreview")} /> : null}
			<p className="content-creation-node__summary">{data.prompt?.trim() || t("node.prompt.empty")}</p>
			{definition.outputs.map((port, index) => (
				<div key={port.id} className="content-creation-port is-output" style={{ top: 50 + index * 26 }}>
					{selected ? <span>{t(port.labelKey)}</span> : null}
					<Handle type="source" id={port.id} position={Position.Right} />
				</div>
			))}
		</div>
	);
}
