import type { AbilityItem } from "../types";

function normalizedName(item: AbilityItem): string {
	return item.title.trim().toLocaleLowerCase();
}

function appendToGroup(groups: Map<string, AbilityItem[]>, key: string, item: AbilityItem): void {
	const group = groups.get(key);
	if (group) group.push(item);
	else groups.set(key, [item]);
}

export function decorateAbilityConflicts(items: AbilityItem[]): AbilityItem[] {
	const sameNameGroups = new Map<string, AbilityItem[]>();
	const physicalGroups = new Map<string, AbilityItem[]>();

	for (const item of items) {
		const name = normalizedName(item);
		if (name) appendToGroup(sameNameGroups, `${item.type}:${name}`, item);
		if (item.type !== "mcp" && item.type !== "bundle") {
			appendToGroup(physicalGroups, `${item.type}:${item.slug}`, item);
		}
	}

	const sameNameIds = new Map<string, string[]>();
	for (const group of sameNameGroups.values()) {
		if (group.length < 2) continue;
		for (const item of group) {
			sameNameIds.set(
				item.id,
				group.filter((candidate) => candidate.id !== item.id).map((candidate) => candidate.id),
			);
		}
	}

	const installConflictIds = new Map<string, string[]>();
	for (const group of physicalGroups.values()) {
		const installed = group.filter((item) => item.installed);
		if (installed.length === 0) continue;
		for (const item of group) {
			if (item.installed) continue;
			installConflictIds.set(
				item.id,
				installed.map((candidate) => candidate.id),
			);
		}
	}

	return items.map((item) => ({
		...item,
		...(sameNameIds.has(item.id) ? { sameNameIds: sameNameIds.get(item.id) } : {}),
		...(installConflictIds.has(item.id) ? { installConflictIds: installConflictIds.get(item.id) } : {}),
	}));
}
