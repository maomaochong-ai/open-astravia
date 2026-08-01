import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { useTranslation } from "@vetta-org/plugin-sdk";
import type { ContentNodeKind, ContentNodeStatus } from "../domain/model";

export interface ContentFlowNodeData extends Record<string, unknown> {
	kind: ContentNodeKind;
	status: ContentNodeStatus;
	label?: string;
	prompt?: string;
}

export type ContentFlowNode = Node<ContentFlowNodeData, "videoNode">;

export function ContentNodeCard({ data, selected }: NodeProps<ContentFlowNode>) {
	const { t } = useTranslation();
	const title = data.label?.trim() || t(`node.kind.${data.kind}`);
	return (
		<div className={`content-creation-node ${selected ? "is-selected" : ""}`}>
			<Handle type="target" position={Position.Left} />
			<div className="content-creation-node__header">
				<span className="content-creation-node__kind">{t(`node.kind.${data.kind}`)}</span>
				<span className={`content-creation-node__status is-${data.status}`}>{t(`node.status.${data.status}`)}</span>
			</div>
			<strong className="content-creation-node__title">{title}</strong>
			<p className="content-creation-node__summary">{data.prompt?.trim() || t("node.prompt.empty")}</p>
			<Handle type="source" position={Position.Right} />
		</div>
	);
}

