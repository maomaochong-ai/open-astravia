import type { ContentNode } from "../project/types";
import { getContentNodeSize } from "../node/geometry";
import type { ContentFlowNode } from "../node/ContentNodeCard";

export interface ContentAlignmentGuides {
	vertical?: { x: number; top: number; bottom: number };
	horizontal?: { y: number; left: number; right: number };
}

interface NodeFrame {
	id: string;
	left: number;
	right: number;
	top: number;
	bottom: number;
	centerX: number;
	centerY: number;
}

function toFrame(node: ContentNode): NodeFrame {
	const fallback = getContentNodeSize(node.kind, node.data.aspectRatio);
	const width = node.width ?? fallback.width;
	const height = node.height ?? fallback.height;
	return {
		id: node.id,
		left: node.position.x,
		right: node.position.x + width,
		top: node.position.y,
		bottom: node.position.y + height,
		centerX: node.position.x + width / 2,
		centerY: node.position.y + height / 2,
	};
}

function toFlowFrame(node: ContentFlowNode): NodeFrame {
	const fallback = getContentNodeSize(node.data.kind, node.data.nodeData.aspectRatio);
	const width = node.width ?? node.measured?.width ?? fallback.width;
	const height = node.height ?? node.measured?.height ?? fallback.height;
	return {
		id: node.id,
		left: node.position.x,
		right: node.position.x + width,
		top: node.position.y,
		bottom: node.position.y + height,
		centerX: node.position.x + width / 2,
		centerY: node.position.y + height / 2,
	};
}

function findAlignmentGuides(
	frames: readonly NodeFrame[],
	activeNodeId: string,
	threshold: number,
): ContentAlignmentGuides {
	const active = frames.find((frame) => frame.id === activeNodeId);
	if (!active) return {};
	const activeX = [active.left, active.centerX, active.right];
	const activeY = [active.top, active.centerY, active.bottom];
	let vertical: ContentAlignmentGuides["vertical"];
	let horizontal: ContentAlignmentGuides["horizontal"];
	let bestX = threshold + 1;
	let bestY = threshold + 1;

	const considerX = (targetX: number, other: NodeFrame) => {
		for (const sourceX of activeX) {
			const distance = Math.abs(sourceX - targetX);
			if (distance <= threshold && distance < bestX) {
				bestX = distance;
				vertical = { x: targetX, top: Math.min(active.top, other.top), bottom: Math.max(active.bottom, other.bottom) };
			}
		}
	};
	const considerY = (targetY: number, other: NodeFrame) => {
		for (const sourceY of activeY) {
			const distance = Math.abs(sourceY - targetY);
			if (distance <= threshold && distance < bestY) {
				bestY = distance;
				horizontal = { y: targetY, left: Math.min(active.left, other.left), right: Math.max(active.right, other.right) };
			}
		}
	};

	for (const other of frames) {
		if (other.id === activeNodeId) continue;
		considerX(other.left, other);
		considerX(other.centerX, other);
		considerX(other.right, other);
		considerY(other.top, other);
		considerY(other.centerY, other);
		considerY(other.bottom, other);
	}

	return { vertical, horizontal };
}

export function findContentAlignmentGuides(
	nodes: readonly ContentNode[],
	activeNodeId: string,
	threshold: number,
): ContentAlignmentGuides {
	return findAlignmentGuides(nodes.map(toFrame), activeNodeId, threshold);
}

export function findContentFlowAlignmentGuides(
	nodes: readonly ContentFlowNode[],
	activeNodeId: string,
	threshold: number,
): ContentAlignmentGuides {
	return findAlignmentGuides(nodes.map(toFlowFrame), activeNodeId, threshold);
}
