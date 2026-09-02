/** A feature-owned value rendered or consumed at a semantic composer anchor. */
export interface ComposerContribution<TRegion extends string, TValue> {
	readonly id: string;
	readonly region: TRegion;
	readonly order?: number;
	readonly value: TValue;
}

export interface ResolvedComposerContribution<TRegion extends string, TValue>
	extends ComposerContribution<TRegion, TValue> {
	readonly capabilityId: string;
	readonly key: string;
}

/**
 * One independently installable composer ability. A hook may own its state and return
 * this immutable snapshot; the composition layer only resolves dependencies and order.
 */
export interface ComposerCapability<TRegion extends string, TValue> {
	readonly id: string;
	readonly requires?: readonly string[];
	readonly conflicts?: readonly string[];
	readonly contributions?: readonly ComposerContribution<TRegion, TValue>[];
}

export type ComposerCapabilityEntry<TRegion extends string, TValue> =
	| ComposerCapability<TRegion, TValue>
	| false
	| null
	| undefined;

export interface ComposerComposition<TRegion extends string, TValue> {
	readonly capabilityIds: ReadonlySet<string>;
	readonly contributions: readonly ResolvedComposerContribution<TRegion, TValue>[];
	get(region: TRegion): readonly ResolvedComposerContribution<TRegion, TValue>[];
	has(capabilityId: string): boolean;
}

/**
 * Resolve an explicit capability list into a deterministic composition. Invalid feature
 * graphs fail during render/development instead of producing a partially working input.
 */
export function composeComposerCapabilities<TRegion extends string, TValue>(
	entries: readonly ComposerCapabilityEntry<TRegion, TValue>[],
): ComposerComposition<TRegion, TValue> {
	const capabilities = entries.filter((entry): entry is ComposerCapability<TRegion, TValue> => Boolean(entry));
	const capabilityOrder = new Map<string, number>();

	for (const [index, capability] of capabilities.entries()) {
		if (capabilityOrder.has(capability.id)) {
			throw new Error(`Duplicate composer capability: ${capability.id}`);
		}
		capabilityOrder.set(capability.id, index);
	}

	for (const capability of capabilities) {
		for (const dependency of capability.requires ?? []) {
			if (!capabilityOrder.has(dependency)) {
				throw new Error(`Composer capability "${capability.id}" requires "${dependency}"`);
			}
		}
		for (const conflict of capability.conflicts ?? []) {
			if (capabilityOrder.has(conflict)) {
				throw new Error(`Composer capability "${capability.id}" conflicts with "${conflict}"`);
			}
		}
	}

	const contributionKeys = new Set<string>();
	const contributions = capabilities
		.flatMap((capability) =>
			(capability.contributions ?? []).map((contribution, contributionIndex) => {
				const key = `${capability.id}:${contribution.id}`;
				if (contributionKeys.has(key)) {
					throw new Error(`Duplicate composer contribution: ${key}`);
				}
				contributionKeys.add(key);
				return {
					capabilityId: capability.id,
					capabilityIndex: capabilityOrder.get(capability.id) ?? 0,
					contributionIndex,
					contribution,
				};
			}),
		)
		.sort(
			(left, right) =>
				(left.contribution.order ?? 0) - (right.contribution.order ?? 0) ||
				left.capabilityIndex - right.capabilityIndex ||
				left.contributionIndex - right.contributionIndex,
		)
		.map(({ capabilityId, contribution }) => ({
			...contribution,
			capabilityId,
			key: `${capabilityId}:${contribution.id}`,
		}));
	const byRegion = new Map<TRegion, ResolvedComposerContribution<TRegion, TValue>[]>();
	for (const contribution of contributions) {
		const current = byRegion.get(contribution.region) ?? [];
		current.push(contribution);
		byRegion.set(contribution.region, current);
	}
	const capabilityIds = new Set(capabilityOrder.keys());

	return {
		capabilityIds,
		contributions,
		get: (region) => byRegion.get(region) ?? [],
		has: (capabilityId) => capabilityIds.has(capabilityId),
	};
}
