import type { MarketplaceSource } from "../../../preload/api-types/abilities.js";

/** Reconcile distribution defaults without changing user-owned identities or switches. */
export function reconcileMarketplaceSources(
	current: MarketplaceSource[],
	defaults: MarketplaceSource[],
	registeredRepositories: string[],
	now: () => Date,
): { sources: MarketplaceSource[]; registeredDefaultRepositories: string[]; changed: boolean } {
	const sources = [...current];
	const registered = new Set(registeredRepositories);
	let changed = false;
	for (const configured of defaults.filter((source) => source.builtin)) {
		const repository = configured.repository.toLowerCase();
		const wasRegistered = registered.has(repository);
		registered.add(repository);
		if (!wasRegistered) changed = true;
		// A manual source already owns this repository, including its branch and installation IDs.
		if (sources.some((source) => source.id !== configured.id && source.repository.toLowerCase() === repository))
			continue;
		const index = sources.findIndex((source) => source.id === configured.id);
		const existing = sources[index];
		if (!existing) {
			// Remember registration even when a manual alias was later removed by the user.
			if (!wasRegistered) {
				sources.push({ ...configured });
				changed = true;
			}
			continue;
		}
		if (!existing.builtin) continue;
		if (
			existing.name === configured.name &&
			existing.repository === configured.repository &&
			existing.archiveUrl === configured.archiveUrl &&
			existing.ref === configured.ref &&
			existing.priority === configured.priority
		)
			continue;
		sources[index] = {
			...existing,
			name: configured.name,
			repository: configured.repository,
			archiveUrl: configured.archiveUrl,
			ref: configured.ref,
			priority: configured.priority,
			updatedAt: now().toISOString(),
		};
		changed = true;
	}
	return {
		sources: sources.sort((a, b) => a.priority - b.priority),
		registeredDefaultRepositories: [...registered],
		changed,
	};
}
