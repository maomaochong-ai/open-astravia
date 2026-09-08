import type { MarketplaceSource } from "../../../preload/api-types/abilities.js";

/**
 * Reconcile distribution defaults without changing user-owned identities or switches.
 * Built-in sources are owned by the distribution: they are always present and enabled.
 */
export function reconcileMarketplaceSources(
	current: MarketplaceSource[],
	defaults: MarketplaceSource[],
	now: () => Date,
): { sources: MarketplaceSource[]; changed: boolean } {
	const sources = [...current];
	let changed = false;
	for (const configured of defaults.filter((source) => source.builtin)) {
		const repository = configured.repository.toLowerCase();
		// A manual source already owns this repository, including its branch and installation IDs.
		if (sources.some((source) => source.id !== configured.id && source.repository.toLowerCase() === repository))
			continue;
		const index = sources.findIndex((source) => source.id === configured.id);
		const existing = sources[index];
		if (!existing) {
			sources.push({ ...configured });
			changed = true;
			continue;
		}
		if (!existing.builtin) continue;
		if (
			existing.name === configured.name &&
			existing.repository === configured.repository &&
			existing.archiveUrl === configured.archiveUrl &&
			existing.ref === configured.ref &&
			existing.priority === configured.priority &&
			existing.enabled
		)
			continue;
		sources[index] = {
			...existing,
			name: configured.name,
			repository: configured.repository,
			archiveUrl: configured.archiveUrl,
			ref: configured.ref,
			priority: configured.priority,
			// 发行方内置来源不可停用；历史数据里的停用状态在此复位。
			enabled: true,
			updatedAt: now().toISOString(),
		};
		changed = true;
	}
	return { sources: sources.sort((a, b) => a.priority - b.priority), changed };
}
