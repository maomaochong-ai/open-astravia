export function reconcileSelectedNodeIds(
	current: string[],
	next: readonly string[],
): string[] {
	if (current.length === next.length) {
		const nextIds = new Set(next);
		if (current.every((nodeId) => nextIds.has(nodeId))) return current;
	}
	return [...next];
}

interface SelectableFlowNode {
	id: string;
	selected?: boolean;
}

/** Keep React Flow's internal selection in sync with programmatic canvas selection. */
export function applySelectedNodeIdsToFlowNodes<NodeType extends SelectableFlowNode>(
	nodes: readonly NodeType[],
	selectedNodeIds: ReadonlySet<string>,
): NodeType[] {
	let changed = false;
	const next = nodes.map((node) => {
		const selected = selectedNodeIds.has(node.id);
		if (Boolean(node.selected) === selected) return node;
		changed = true;
		return { ...node, selected };
	});
	return changed ? next : (nodes as NodeType[]);
}
