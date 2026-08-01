import type { ContentEdge, ContentNode, ContentNodeKind, ContentProjectDocument } from "./model";
import {
	CONTENT_NODE_DEFINITIONS,
	createDefaultContentNodeData,
	getContentNodeDefinition,
	type ContentPortDataType,
	type ContentPortDefinition,
} from "./node-definitions";

export interface ResolvedContentConnection {
	sourceHandle: string;
	targetHandle: string;
}

interface NodeShape {
	kind: ContentNodeKind;
}

function arePortTypesCompatible(source: ContentPortDataType, target: ContentPortDataType): boolean {
	if (target === "content" || source === target) return true;
	const mediaTypes: readonly ContentPortDataType[] = ["image", "video", "audio", "media"];
	return mediaTypes.includes(source) && mediaTypes.includes(target) && (source === "media" || target === "media");
}

function matchingPorts(
	source: NodeShape,
	target: NodeShape,
	sourceHandle?: string | null,
	targetHandle?: string | null,
): Array<{ source: ContentPortDefinition; target: ContentPortDefinition }> {
	const sourcePorts = getContentNodeDefinition(source.kind).outputs.filter(
		(port) => !sourceHandle || port.id === sourceHandle,
	);
	const targetPorts = getContentNodeDefinition(target.kind).inputs.filter(
		(port) => !targetHandle || port.id === targetHandle,
	);
	return sourcePorts.flatMap((sourcePort) =>
		targetPorts
			.filter((targetPort) => arePortTypesCompatible(sourcePort.dataType, targetPort.dataType))
			.map((targetPort) => ({ source: sourcePort, target: targetPort })),
	);
}

function createsCycle(edges: readonly ContentEdge[], source: string, target: string): boolean {
	const nextBySource = new Map<string, string[]>();
	for (const edge of edges) {
		const targets = nextBySource.get(edge.source) ?? [];
		targets.push(edge.target);
		nextBySource.set(edge.source, targets);
	}
	const pending = [target];
	const visited = new Set<string>();
	while (pending.length > 0) {
		const current = pending.pop();
		if (!current || visited.has(current)) continue;
		if (current === source) return true;
		visited.add(current);
		pending.push(...(nextBySource.get(current) ?? []));
	}
	return false;
}

export function resolveContentConnection(
	project: ContentProjectDocument,
	sourceNode: ContentNode,
	targetNode: ContentNode,
	sourceHandle?: string | null,
	targetHandle?: string | null,
): ResolvedContentConnection | null {
	if (sourceNode.id === targetNode.id || createsCycle(project.graph.edges, sourceNode.id, targetNode.id)) return null;
	for (const match of matchingPorts(sourceNode, targetNode, sourceHandle, targetHandle)) {
		const duplicate = project.graph.edges.some(
			(edge) =>
				edge.source === sourceNode.id &&
				edge.target === targetNode.id &&
				(edge.sourceHandle ?? match.source.id) === match.source.id &&
				(edge.targetHandle ?? match.target.id) === match.target.id,
		);
		if (duplicate) return { sourceHandle: match.source.id, targetHandle: match.target.id };
		const targetOccupied =
			!match.target.multiple &&
			project.graph.edges.some(
				(edge) => edge.target === targetNode.id && (edge.targetHandle ?? match.target.id) === match.target.id,
			);
		if (!targetOccupied) return { sourceHandle: match.source.id, targetHandle: match.target.id };
	}
	return null;
}

export function listCompatibleNodeKinds(
	project: ContentProjectDocument,
	node: ContentNode,
	direction: "source" | "target",
	handleId?: string | null,
): ContentNodeKind[] {
	const kinds: ContentNodeKind[] = CONTENT_NODE_DEFINITIONS.map((definition) => definition.kind);
	return kinds.filter((kind) => {
		const candidate: ContentNode = {
			id: `candidate:${kind}`,
			kind,
			position: { x: 0, y: 0 },
			status: "idle",
			data: createDefaultContentNodeData(kind),
		};
		return direction === "source"
			? resolveContentConnection(project, node, candidate, handleId, undefined) !== null
			: resolveContentConnection(project, candidate, node, undefined, handleId) !== null;
	});
}
