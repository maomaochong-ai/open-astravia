import type { CodingAgentSessionEntry, CodingAgentSessionTreeNode } from "../contracts/session-entry.js";

export function projectCodingAgentSessionTree(
	entries: readonly CodingAgentSessionEntry[],
	labels: ReadonlyMap<string, string>,
): CodingAgentSessionTreeNode[] {
	const nodes = new Map<string, CodingAgentSessionTreeNode>();
	const roots: CodingAgentSessionTreeNode[] = [];
	for (const entry of entries) nodes.set(entry.id, { entry, children: [], label: labels.get(entry.id) });
	for (const entry of entries) {
		const node = nodes.get(entry.id);
		if (!node) continue;
		const parent = entry.parentId && entry.parentId !== entry.id ? nodes.get(entry.parentId) : undefined;
		if (parent) parent.children.push(node);
		else roots.push(node);
	}
	const stack = [...roots];
	while (stack.length > 0) {
		const node = stack.pop();
		if (!node) continue;
		node.children.sort((left, right) => Date.parse(left.entry.timestamp) - Date.parse(right.entry.timestamp));
		stack.push(...node.children);
	}
	return roots;
}

export function readCodingAgentSessionLabels(entries: readonly CodingAgentSessionEntry[]): Map<string, string> {
	const labels = new Map<string, string>();
	for (const entry of entries) {
		if (entry.type !== "label") continue;
		if (entry.label === undefined) labels.delete(entry.targetId);
		else labels.set(entry.targetId, entry.label);
	}
	return labels;
}

export function readCodingAgentSessionBranch(
	entries: readonly CodingAgentSessionEntry[],
	leafId: string | null,
): CodingAgentSessionEntry[] {
	const byId = new Map(entries.map((entry) => [entry.id, entry]));
	const branch: CodingAgentSessionEntry[] = [];
	let current = leafId ? byId.get(leafId) : undefined;
	while (current) {
		branch.unshift(current);
		current = current.parentId ? byId.get(current.parentId) : undefined;
	}
	return branch;
}
