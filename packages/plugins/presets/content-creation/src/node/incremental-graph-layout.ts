import { getContentNodeSize } from "./geometry";
import type { CanvasPosition, ContentEdge, ContentNode, ContentProjectDocument } from "../project/types";

const HORIZONTAL_GAP = 96;
const VERTICAL_GAP = 56;
const GRID_SIZE = 8;
const COLLISION_PADDING = 24;

interface NodeFrame {
	id: string;
	position: CanvasPosition;
	width: number;
	height: number;
}

export interface IncrementalGraphLayoutDiagnostic {
	code: "locked-layout-constraint" | "layout-overlap";
	nodeIds: string[];
}

export interface IncrementalGraphLayoutResult {
	placements: Array<{ nodeId: string; position: CanvasPosition }>;
	movedExistingNodeIds: string[];
	diagnostics: IncrementalGraphLayoutDiagnostic[];
}

/**
 * Lays out only components touched by newly created Agent nodes. Existing automatic nodes may be
 * reorganized with them; user-owned nodes act as anchors and move horizontally only when an
 * inserted path needs space. Locked nodes never move.
 */
export function planIncrementalContentGraphLayout(
	before: ContentProjectDocument,
	after: ContentProjectDocument,
	addedNodeIds: ReadonlySet<string>,
): IncrementalGraphLayoutResult {
	const existingNodeIds = new Set(before.graph.nodes.map((node) => node.id));
	const nodesById = new Map(after.graph.nodes.map((node) => [node.id, node]));
	const survivingAddedNodeIds = new Set([...addedNodeIds].filter((nodeId) => nodesById.has(nodeId)));
	if (survivingAddedNodeIds.size === 0) return emptyLayoutResult();

	const adjacency = buildUndirectedAdjacency(after.graph.nodes, after.graph.edges);
	const components = touchedComponents(survivingAddedNodeIds, adjacency);
	const positions = new Map(after.graph.nodes.map((node) => [node.id, { ...node.position }]));
	const activeNodeIds = new Set<string>();
	const diagnostics: IncrementalGraphLayoutDiagnostic[] = [];

	for (const component of components) {
		const managedNodeIds = new Set(
			[...component].filter((nodeId) => {
				const node = nodesById.get(nodeId);
				return Boolean(node && !node.locked && (survivingAddedNodeIds.has(nodeId) || node.layoutOwnership === "automatic"));
			}),
		);
		if (managedNodeIds.size === 0) continue;
		for (const nodeId of managedNodeIds) activeNodeIds.add(nodeId);

		const componentEdges = after.graph.edges.filter(
			(edge) => component.has(edge.source) && component.has(edge.target),
		);
		if (componentEdges.length === 0 && component.size === 1) continue;

		placeManagedComponent(
			before,
			after.graph.nodes,
			componentEdges,
			component,
			managedNodeIds,
			positions,
		);
		relaxHorizontalFlow(
			componentEdges,
			component,
			managedNodeIds,
			nodesById,
			positions,
			activeNodeIds,
			diagnostics,
		);
	}

	packManagedNodes(after.graph.nodes, activeNodeIds, positions);
	appendOverlapDiagnostics(after.graph.nodes, activeNodeIds, positions, diagnostics);

	const placements = after.graph.nodes.flatMap((node) => {
		const position = positions.get(node.id);
		if (!position || samePosition(position, node.position)) return [];
		return [{ nodeId: node.id, position }];
	});
	return {
		placements,
		movedExistingNodeIds: placements
			.map(({ nodeId }) => nodeId)
			.filter((nodeId) => existingNodeIds.has(nodeId)),
		diagnostics,
	};
}

function emptyLayoutResult(): IncrementalGraphLayoutResult {
	return { placements: [], movedExistingNodeIds: [], diagnostics: [] };
}

function buildUndirectedAdjacency(nodes: readonly ContentNode[], edges: readonly ContentEdge[]) {
	const adjacency = new Map(nodes.map((node) => [node.id, new Set<string>()]));
	for (const edge of edges) {
		adjacency.get(edge.source)?.add(edge.target);
		adjacency.get(edge.target)?.add(edge.source);
	}
	return adjacency;
}

function touchedComponents(
	addedNodeIds: ReadonlySet<string>,
	adjacency: ReadonlyMap<string, ReadonlySet<string>>,
): Set<string>[] {
	const visited = new Set<string>();
	const components: Set<string>[] = [];
	for (const nodeId of addedNodeIds) {
		if (visited.has(nodeId)) continue;
		const component = new Set<string>();
		const queue = [nodeId];
		visited.add(nodeId);
		while (queue.length > 0) {
			const current = queue.shift();
			if (!current) continue;
			component.add(current);
			for (const adjacent of adjacency.get(current) ?? []) {
				if (visited.has(adjacent)) continue;
				visited.add(adjacent);
				queue.push(adjacent);
			}
		}
		components.push(component);
	}
	return components;
}

function placeManagedComponent(
	before: ContentProjectDocument,
	nodes: readonly ContentNode[],
	edges: readonly ContentEdge[],
	component: ReadonlySet<string>,
	managedNodeIds: ReadonlySet<string>,
	positions: Map<string, CanvasPosition>,
): void {
	const componentNodes = nodes.filter((node) => component.has(node.id));
	const { ranks, orderedNodeIds } = rankComponent(componentNodes, edges);
	const layout = layeredComponentLayout(componentNodes, edges, ranks, orderedNodeIds);
	const anchors = componentNodes.filter((node) => !managedNodeIds.has(node.id));
	const existingManaged = componentNodes.some(
		(node) => managedNodeIds.has(node.id) && before.graph.nodes.some((previous) => previous.id === node.id),
	);
	const origin = anchors.length > 0
		? anchoredOrigin(anchors, layout)
		: unanchoredOrigin(before, componentNodes, layout, existingManaged);

	for (const node of componentNodes) {
		if (!managedNodeIds.has(node.id)) continue;
		const local = layout.get(node.id);
		if (!local) continue;
		positions.set(node.id, {
			x: snap(origin.x + local.x),
			y: snap(origin.y + local.y),
		});
	}
}

function rankComponent(nodes: readonly ContentNode[], edges: readonly ContentEdge[]) {
	const nodeIds = new Set(nodes.map((node) => node.id));
	const nodeOrder = new Map(nodes.map((node, index) => [node.id, index]));
	const indegree = new Map(nodes.map((node) => [node.id, 0]));
	const outgoing = new Map(nodes.map((node) => [node.id, [] as string[]]));
	for (const edge of edges) {
		if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) continue;
		indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1);
		outgoing.get(edge.source)?.push(edge.target);
	}
	const queue = nodes.filter((node) => indegree.get(node.id) === 0).map((node) => node.id);
	const ranks = new Map(nodes.map((node) => [node.id, 0]));
	const orderedNodeIds: string[] = [];
	while (queue.length > 0) {
		queue.sort((left, right) => (nodeOrder.get(left) ?? 0) - (nodeOrder.get(right) ?? 0));
		const nodeId = queue.shift();
		if (!nodeId) continue;
		orderedNodeIds.push(nodeId);
		for (const target of outgoing.get(nodeId) ?? []) {
			ranks.set(target, Math.max(ranks.get(target) ?? 0, (ranks.get(nodeId) ?? 0) + 1));
			const next = (indegree.get(target) ?? 1) - 1;
			indegree.set(target, next);
			if (next === 0) queue.push(target);
		}
	}
	for (const node of nodes) {
		if (!orderedNodeIds.includes(node.id)) orderedNodeIds.push(node.id);
	}
	return { ranks, orderedNodeIds };
}

function layeredComponentLayout(
	nodes: readonly ContentNode[],
	edges: readonly ContentEdge[],
	ranks: ReadonlyMap<string, number>,
	orderedNodeIds: readonly string[],
): Map<string, CanvasPosition> {
	const nodesById = new Map(nodes.map((node) => [node.id, node]));
	const order = new Map(orderedNodeIds.map((nodeId, index) => [nodeId, index]));
	const predecessorY = new Map<string, number[]>();
	for (const edge of edges) {
		const source = nodesById.get(edge.source);
		if (!source || !nodesById.has(edge.target)) continue;
		const values = predecessorY.get(edge.target) ?? [];
		values.push(source.position.y + nodeFrame(source).height / 2);
		predecessorY.set(edge.target, values);
	}
	const groups = new Map<number, ContentNode[]>();
	for (const node of nodes) {
		const rank = ranks.get(node.id) ?? 0;
		const group = groups.get(rank) ?? [];
		group.push(node);
		groups.set(rank, group);
	}
	for (const group of groups.values()) {
		group.sort((left, right) => {
			const leftValues = predecessorY.get(left.id) ?? [left.position.y];
			const rightValues = predecessorY.get(right.id) ?? [right.position.y];
			return average(leftValues) - average(rightValues) || (order.get(left.id) ?? 0) - (order.get(right.id) ?? 0);
		});
	}
	const maximumRank = Math.max(0, ...groups.keys());
	const columnWidths = Array.from({ length: maximumRank + 1 }, (_, rank) =>
		Math.max(0, ...(groups.get(rank) ?? []).map((node) => nodeFrame(node).width)),
	);
	const columnX: number[] = [];
	for (let rank = 0; rank <= maximumRank; rank += 1) {
		columnX[rank] = rank === 0 ? 0 : (columnX[rank - 1] ?? 0) + (columnWidths[rank - 1] ?? 0) + HORIZONTAL_GAP;
	}
	const columnHeights = Array.from({ length: maximumRank + 1 }, (_, rank) => {
		const group = groups.get(rank) ?? [];
		return group.reduce((total, node) => total + nodeFrame(node).height, 0) + Math.max(0, group.length - 1) * VERTICAL_GAP;
	});
	const maximumHeight = Math.max(0, ...columnHeights);
	const result = new Map<string, CanvasPosition>();
	for (let rank = 0; rank <= maximumRank; rank += 1) {
		let y = (maximumHeight - (columnHeights[rank] ?? 0)) / 2;
		for (const node of groups.get(rank) ?? []) {
			result.set(node.id, { x: columnX[rank] ?? 0, y });
			y += nodeFrame(node).height + VERTICAL_GAP;
		}
	}
	return result;
}

function anchoredOrigin(
	anchors: readonly ContentNode[],
	localPositions: ReadonlyMap<string, CanvasPosition>,
): CanvasPosition {
	const xOffsets = anchors.flatMap((node) => {
		const local = localPositions.get(node.id);
		return local ? [node.position.x - local.x] : [];
	});
	const yOffsets = anchors.flatMap((node) => {
		const local = localPositions.get(node.id);
		return local ? [node.position.y - local.y] : [];
	});
	return { x: median(xOffsets), y: median(yOffsets) };
}

function unanchoredOrigin(
	before: ContentProjectDocument,
	componentNodes: readonly ContentNode[],
	localPositions: ReadonlyMap<string, CanvasPosition>,
	existingManaged: boolean,
): CanvasPosition {
	if (existingManaged) {
		const xOffsets = componentNodes.flatMap((node) => {
			const local = localPositions.get(node.id);
			return local ? [node.position.x - local.x] : [];
		});
		const yOffsets = componentNodes.flatMap((node) => {
			const local = localPositions.get(node.id);
			return local ? [node.position.y - local.y] : [];
		});
		return { x: median(xOffsets), y: median(yOffsets) };
	}
	if (before.graph.nodes.length === 0) return { x: 0, y: 0 };
	const frames = before.graph.nodes.map(nodeFrame);
	return {
		x: Math.min(...frames.map((frame) => frame.position.x)),
		y: Math.max(...frames.map((frame) => frame.position.y + frame.height)) + VERTICAL_GAP * 2,
	};
}

function relaxHorizontalFlow(
	edges: readonly ContentEdge[],
	component: ReadonlySet<string>,
	managedNodeIds: ReadonlySet<string>,
	nodesById: ReadonlyMap<string, ContentNode>,
	positions: Map<string, CanvasPosition>,
	activeNodeIds: Set<string>,
	diagnostics: IncrementalGraphLayoutDiagnostic[],
): void {
	const active = new Set(managedNodeIds);
	const maximumPasses = Math.max(1, component.size * component.size);
	for (let pass = 0; pass < maximumPasses; pass += 1) {
		let changed = false;
		for (const edge of edges) {
			if (!active.has(edge.source) && !active.has(edge.target)) continue;
			const source = nodesById.get(edge.source);
			const target = nodesById.get(edge.target);
			const sourcePosition = positions.get(edge.source);
			const targetPosition = positions.get(edge.target);
			if (!source || !target || !sourcePosition || !targetPosition) continue;
			const requiredX = sourcePosition.x + nodeFrame(source).width + HORIZONTAL_GAP;
			if (targetPosition.x >= requiredX) continue;
			if (target.locked) {
				appendDiagnostic(diagnostics, { code: "locked-layout-constraint", nodeIds: [source.id, target.id] });
				continue;
			}
			const shiftIds = unlockedDescendants(target.id, edges, component, nodesById);
			const delta = requiredX - targetPosition.x;
			for (const nodeId of shiftIds) {
				const position = positions.get(nodeId);
				if (!position) continue;
				positions.set(nodeId, { x: snap(position.x + delta), y: position.y });
				active.add(nodeId);
				activeNodeIds.add(nodeId);
			}
			changed = true;
		}
		if (!changed) return;
	}
}

function unlockedDescendants(
	startNodeId: string,
	edges: readonly ContentEdge[],
	component: ReadonlySet<string>,
	nodesById: ReadonlyMap<string, ContentNode>,
): Set<string> {
	const result = new Set<string>();
	const queue = [startNodeId];
	while (queue.length > 0) {
		const nodeId = queue.shift();
		if (!nodeId || result.has(nodeId) || !component.has(nodeId)) continue;
		const node = nodesById.get(nodeId);
		if (!node || node.locked) continue;
		result.add(nodeId);
		for (const edge of edges) {
			if (edge.source === nodeId) queue.push(edge.target);
		}
	}
	return result;
}

function packManagedNodes(
	nodes: readonly ContentNode[],
	activeNodeIds: ReadonlySet<string>,
	positions: Map<string, CanvasPosition>,
): void {
	const movable = nodes.filter((node) => activeNodeIds.has(node.id) && node.layoutOwnership === "automatic");
	const movableNodeIds = new Set(movable.map((node) => node.id));
	const occupied = nodes
		.filter((node) => !movableNodeIds.has(node.id))
		.map((node) => frameAt(node, positions.get(node.id) ?? node.position));
	for (const node of movable) {
		const position = positions.get(node.id) ?? node.position;
		const frame = frameAt(node, position);
		let y = position.y;
		for (let attempt = 0; attempt < 256; attempt += 1) {
			const candidate = { ...frame, position: { x: position.x, y: snap(y) } };
			if (!occupied.some((other) => framesOverlap(candidate, other, COLLISION_PADDING))) {
				positions.set(node.id, candidate.position);
				occupied.push(candidate);
				break;
			}
			y += GRID_SIZE;
		}
	}
}

function appendOverlapDiagnostics(
	nodes: readonly ContentNode[],
	activeNodeIds: ReadonlySet<string>,
	positions: ReadonlyMap<string, CanvasPosition>,
	diagnostics: IncrementalGraphLayoutDiagnostic[],
): void {
	for (let leftIndex = 0; leftIndex < nodes.length; leftIndex += 1) {
		const left = nodes[leftIndex];
		if (!left) continue;
		for (let rightIndex = leftIndex + 1; rightIndex < nodes.length; rightIndex += 1) {
			const right = nodes[rightIndex];
			if (!right) continue;
			if (!activeNodeIds.has(left.id) && !activeNodeIds.has(right.id)) continue;
			if (
				framesOverlap(
					frameAt(left, positions.get(left.id) ?? left.position),
					frameAt(right, positions.get(right.id) ?? right.position),
					0,
				)
			) {
				appendDiagnostic(diagnostics, { code: "layout-overlap", nodeIds: [left.id, right.id] });
			}
		}
	}
}

function appendDiagnostic(
	diagnostics: IncrementalGraphLayoutDiagnostic[],
	diagnostic: IncrementalGraphLayoutDiagnostic,
): void {
	const key = diagnostic.nodeIds.join("\u0000");
	if (diagnostics.some((current) => current.code === diagnostic.code && current.nodeIds.join("\u0000") === key)) return;
	diagnostics.push(diagnostic);
}

function nodeFrame(node: ContentNode): NodeFrame {
	return frameAt(node, node.position);
}

function frameAt(node: ContentNode, position: CanvasPosition): NodeFrame {
	const fallback = getContentNodeSize(node.kind, node.data.aspectRatio);
	return {
		id: node.id,
		position,
		width: node.width ?? fallback.width,
		height: node.height ?? fallback.height,
	};
}

function framesOverlap(left: NodeFrame, right: NodeFrame, padding: number): boolean {
	return !(
		left.position.x + left.width + padding <= right.position.x ||
		right.position.x + right.width + padding <= left.position.x ||
		left.position.y + left.height + padding <= right.position.y ||
		right.position.y + right.height + padding <= left.position.y
	);
}

function average(values: readonly number[]): number {
	return values.reduce((total, value) => total + value, 0) / Math.max(1, values.length);
}

function median(values: readonly number[]): number {
	if (values.length === 0) return 0;
	const sorted = [...values].sort((left, right) => left - right);
	const middle = Math.floor(sorted.length / 2);
	if (sorted.length % 2 === 1) return sorted[middle] ?? 0;
	return ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

function snap(value: number): number {
	return Math.round(value / GRID_SIZE) * GRID_SIZE;
}

function samePosition(left: CanvasPosition, right: CanvasPosition): boolean {
	return Math.abs(left.x - right.x) < 0.5 && Math.abs(left.y - right.y) < 0.5;
}
