import type { ContentNode } from "../project/types";
import { getContentNodeSize } from "../node/geometry";

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

export function findContentAlignmentGuides(
	nodes: readonly ContentNode[],
	activeNodeId: string,
	threshold: number,
): ContentAlignmentGuides {
	const frames = nodes.map(toFrame);
	const active = frames.find((frame) => frame.id === activeNodeId);
	if (!active) return {};
	const others = frames.filter((frame) => frame.id !== activeNodeId);
	const activeX = [active.left, active.centerX, active.right];
	const activeY = [active.top, active.centerY, active.bottom];
	let vertical: ContentAlignmentGuides["vertical"];
	let horizontal: ContentAlignmentGuides["horizontal"];
	let bestX = threshold + 1;
	let bestY = threshold + 1;

	for (const other of others) {
		for (const targetX of [other.left, other.centerX, other.right]) {
			for (const sourceX of activeX) {
				const distance = Math.abs(sourceX - targetX);
				if (distance <= threshold && distance < bestX) {
					bestX = distance;
					vertical = { x: targetX, top: Math.min(active.top, other.top), bottom: Math.max(active.bottom, other.bottom) };
				}
			}
		}
		for (const targetY of [other.top, other.centerY, other.bottom]) {
			for (const sourceY of activeY) {
				const distance = Math.abs(sourceY - targetY);
				if (distance <= threshold && distance < bestY) {
					bestY = distance;
					horizontal = { y: targetY, left: Math.min(active.left, other.left), right: Math.max(active.right, other.right) };
				}
			}
		}
	}

	return { vertical, horizontal };
}
