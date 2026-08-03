import type { CanvasPosition, ContentNode } from "../project/types";
import { getContentNodeSize } from "./geometry";

export type ContentNodeAlignment = "left" | "center-x" | "right" | "top" | "center-y" | "bottom";
export type ContentNodeLayout = "row" | "column" | "grid";

export interface ContentNodePlacement {
	nodeId: string;
	position: CanvasPosition;
}

function nodeSize(node: ContentNode): { width: number; height: number } {
	const fallback = getContentNodeSize(node.kind, node.data.aspectRatio);
	return { width: node.width ?? fallback.width, height: node.height ?? fallback.height };
}

export function alignContentNodes(nodes: readonly ContentNode[], alignment: ContentNodeAlignment): ContentNodePlacement[] {
	if (nodes.length < 2) return [];
	const frames = nodes.map((node) => ({ node, ...nodeSize(node) }));
	const left = Math.min(...frames.map(({ node }) => node.position.x));
	const right = Math.max(...frames.map(({ node, width }) => node.position.x + width));
	const top = Math.min(...frames.map(({ node }) => node.position.y));
	const bottom = Math.max(...frames.map(({ node, height }) => node.position.y + height));
	const centerX = (left + right) / 2;
	const centerY = (top + bottom) / 2;

	return frames.map(({ node, width, height }) => ({
		nodeId: node.id,
		position: {
			x:
				alignment === "left"
					? left
					: alignment === "center-x"
						? centerX - width / 2
						: alignment === "right"
							? right - width
							: node.position.x,
			y:
				alignment === "top"
					? top
					: alignment === "center-y"
						? centerY - height / 2
						: alignment === "bottom"
							? bottom - height
							: node.position.y,
		},
	}));
}

export function layoutContentNodes(
	nodes: readonly ContentNode[],
	layout: ContentNodeLayout,
	gap = 48,
): ContentNodePlacement[] {
	if (nodes.length < 2) return [];
	const frames = nodes
		.map((node) => ({ node, ...nodeSize(node) }))
		.sort((a, b) => a.node.position.y - b.node.position.y || a.node.position.x - b.node.position.x);
	const originX = Math.min(...frames.map(({ node }) => node.position.x));
	const originY = Math.min(...frames.map(({ node }) => node.position.y));

	if (layout === "row") {
		let x = originX;
		return [...frames]
			.sort((a, b) => a.node.position.x - b.node.position.x || a.node.position.y - b.node.position.y)
			.map(({ node, width }) => {
				const placement = { nodeId: node.id, position: { x, y: originY } };
				x += width + gap;
				return placement;
			});
	}

	if (layout === "column") {
		let y = originY;
		return frames.map(({ node, height }) => {
			const placement = { nodeId: node.id, position: { x: originX, y } };
			y += height + gap;
			return placement;
		});
	}

	const columns = Math.ceil(Math.sqrt(frames.length));
	const cellWidth = Math.max(...frames.map(({ width }) => width)) + gap;
	const cellHeight = Math.max(...frames.map(({ height }) => height)) + gap;
	return frames.map(({ node }, index) => ({
		nodeId: node.id,
		position: {
			x: originX + (index % columns) * cellWidth,
			y: originY + Math.floor(index / columns) * cellHeight,
		},
	}));
}
