import type { Edge } from "@xyflow/react";
import { getContentNodeSize } from "../node/geometry";
import type { ContentNodeData, ContentProjectDocument } from "../project/types";
import type { ContentModelDescriptor } from "../generation/types";
import type { ContentFlowNode } from "../node/ContentNodeCard";

export interface ContentNodeActions {
	onDelete: (nodeId: string) => void;
	onDuplicate: (nodeId: string) => void;
	onToggleLock: (nodeId: string) => void;
	onUpdate: (nodeId: string, data: ContentNodeData) => Promise<void>;
	onResize: (nodeId: string, position: { x: number; y: number }, width: number, height: number) => void;
	onRunNode: (nodeId: string) => Promise<void>;
	onAddToTimeline: (nodeId: string) => Promise<void>;
}

export function getNextClipStart(project: ContentProjectDocument, trackId: string): number {
	const track = project.timeline.tracks.find((candidate) => candidate.id === trackId);
	return track?.clips.reduce((end, clip) => Math.max(end, clip.start + clip.duration), 0) ?? 0;
}

export function toContentFlowNodes(
	project: ContentProjectDocument,
	selectedNodeIds: ReadonlySet<string>,
	models: readonly ContentModelDescriptor[],
	actions: ContentNodeActions,
): ContentFlowNode[] {
	return project.graph.nodes.map((node) => {
		const fallbackSize = getContentNodeSize(node.kind, node.data.aspectRatio);
		const job = project.jobs.filter((candidate) => candidate.nodeId === node.id).at(-1);
		return {
			...fallbackSize,
			width: node.width ?? fallbackSize.width,
			height: node.height ?? fallbackSize.height,
			id: node.id,
			type: "contentNode",
			position: node.position,
			selected: selectedNodeIds.has(node.id),
			draggable: !node.locked,
			data: {
				kind: node.kind,
				nodeData: node.data,
				assetUrl: node.data.assetId ? project.assets.find((asset) => asset.id === node.data.assetId)?.url : undefined,
				assetKind: node.data.assetId ? project.assets.find((asset) => asset.id === node.data.assetId)?.kind : undefined,
				status: node.status,
				job,
				locked: Boolean(node.locked),
				models,
				hasGenerationError: job?.status === "failed",
				onDelete: () => actions.onDelete(node.id),
				onDuplicate: () => actions.onDuplicate(node.id),
				onToggleLock: () => actions.onToggleLock(node.id),
				onUpdate: (data) => actions.onUpdate(node.id, data),
				onResize: (position, width, height) => actions.onResize(node.id, position, width, height),
				onRunNode: () => actions.onRunNode(node.id),
				onAddToTimeline:
					node.kind === "image-generator" || node.kind === "video-generator" || node.kind === "asset"
						? () => actions.onAddToTimeline(node.id)
						: undefined,
			},
		};
	});
}

export function toContentFlowEdges(project: ContentProjectDocument, selectedNodeIds: ReadonlySet<string>): Edge[] {
	return project.graph.edges.map((edge) => ({
		...edge,
		className: selectedNodeIds.has(edge.source) || selectedNodeIds.has(edge.target) ? "is-related" : undefined,
		sourceHandle: edge.sourceHandle,
		targetHandle: edge.targetHandle,
	}));
}

export function getConnectionPointerPosition(event: MouseEvent | TouchEvent): { x: number; y: number } | null {
	if ("changedTouches" in event) {
		const touch = event.changedTouches[0];
		return touch ? { x: touch.clientX, y: touch.clientY } : null;
	}
	return { x: event.clientX, y: event.clientY };
}
