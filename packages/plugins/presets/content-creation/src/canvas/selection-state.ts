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
