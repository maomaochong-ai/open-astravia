import type { ContentEdge, ContentNode, ContentNodeKind, ContentProjectDocument } from "../project/types";
import {
	CONTENT_NODE_DEFINITIONS,
	createDefaultContentNodeData,
	getContentNodeDefinition,
	type ContentPortDataType,
	type ContentPortDefinition,
} from "./definitions";

export interface ResolvedContentConnection {
	sourceHandle: string;
	targetHandle: string;
}

export type ContentConnectionFailureCode =
	| "self-connection"
	| "source-port-not-found"
	| "target-port-not-found"
	| "type-mismatch"
	| "would-create-cycle"
	| "target-occupied";

export type ContentConnectionResolution =
	| { ok: true; connection: ResolvedContentConnection }
	| {
			ok: false;
			code: ContentConnectionFailureCode;
			cyclePath?: string[];
			availableSourceHandles?: string[];
			availableTargetHandles?: string[];
	  };

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

function findCyclePath(edges: readonly ContentEdge[], source: string, target: string): string[] | null {
	const nextBySource = new Map<string, string[]>();
	for (const edge of edges) {
		const targets = nextBySource.get(edge.source) ?? [];
		targets.push(edge.target);
		nextBySource.set(edge.source, targets);
	}
	const pending = [target];
	const visited = new Set<string>();
	const previous = new Map<string, string>();
	while (pending.length > 0) {
		const current = pending.pop();
		if (!current || visited.has(current)) continue;
		if (current === source) {
			const existingPath = [source];
			let cursor = source;
			while (cursor !== target) {
				const parent = previous.get(cursor);
				if (!parent) break;
				existingPath.unshift(parent);
				cursor = parent;
			}
			return [source, ...existingPath];
		}
		visited.add(current);
		for (const next of nextBySource.get(current) ?? []) {
			if (!previous.has(next)) previous.set(next, current);
			pending.push(next);
		}
	}
	return null;
}

export function resolveContentConnectionResult(
	project: ContentProjectDocument,
	sourceNode: ContentNode,
	targetNode: ContentNode,
	sourceHandle?: string | null,
	targetHandle?: string | null,
): ContentConnectionResolution {
	if (sourceNode.id === targetNode.id) return { ok: false, code: "self-connection" };
	const sourcePorts = getContentNodeDefinition(sourceNode.kind).outputs;
	const targetPorts = getContentNodeDefinition(targetNode.kind).inputs;
	if (sourceHandle && !sourcePorts.some((port) => port.id === sourceHandle)) {
		return {
			ok: false,
			code: "source-port-not-found",
			availableSourceHandles: sourcePorts.map((port) => port.id),
		};
	}
	if (targetHandle && !targetPorts.some((port) => port.id === targetHandle)) {
		return {
			ok: false,
			code: "target-port-not-found",
			availableTargetHandles: targetPorts.map((port) => port.id),
		};
	}
	const matches = matchingPorts(sourceNode, targetNode, sourceHandle, targetHandle);
	if (matches.length === 0) {
		return {
			ok: false,
			code: "type-mismatch",
			availableSourceHandles: sourcePorts.map((port) => port.id),
			availableTargetHandles: targetPorts.map((port) => port.id),
		};
	}
	const cyclePath = findCyclePath(project.graph.edges, sourceNode.id, targetNode.id);
	if (cyclePath) return { ok: false, code: "would-create-cycle", cyclePath };
	for (const match of matches) {
		const duplicate = project.graph.edges.some(
			(edge) =>
				edge.source === sourceNode.id &&
				edge.target === targetNode.id &&
				(edge.sourceHandle ?? match.source.id) === match.source.id &&
				(edge.targetHandle ?? match.target.id) === match.target.id,
		);
		if (duplicate) {
			return { ok: true, connection: { sourceHandle: match.source.id, targetHandle: match.target.id } };
		}
		const targetOccupied =
			!match.target.multiple &&
			project.graph.edges.some(
				(edge) => edge.target === targetNode.id && (edge.targetHandle ?? match.target.id) === match.target.id,
			);
		if (!targetOccupied) {
			return { ok: true, connection: { sourceHandle: match.source.id, targetHandle: match.target.id } };
		}
	}
	return {
		ok: false,
		code: "target-occupied",
		availableTargetHandles: targetPorts.map((port) => port.id),
	};
}

export function resolveContentConnection(
	project: ContentProjectDocument,
	sourceNode: ContentNode,
	targetNode: ContentNode,
	sourceHandle?: string | null,
	targetHandle?: string | null,
): ResolvedContentConnection | null {
	const result = resolveContentConnectionResult(project, sourceNode, targetNode, sourceHandle, targetHandle);
	return result.ok ? result.connection : null;
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
