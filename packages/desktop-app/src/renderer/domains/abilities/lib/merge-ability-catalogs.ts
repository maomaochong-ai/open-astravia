import type {
	AbilityLedger,
	GitHubMarketplaceOrigin,
	OpenMarketplaceAbility,
	OpenMarketplaceSourceSnapshot,
} from "@preload/api";
import type { MarketAbility } from "@shared/lib/api";

export type OpenCatalogMarketAbility = MarketAbility & {
	origin: GitHubMarketplaceOrigin;
	configVersion: number;
};

function toMarketAbility(ability: OpenMarketplaceAbility, syncedAt: string | null): OpenCatalogMarketAbility {
	return {
		slug: ability.slug,
		type: ability.type,
		name: ability.name,
		description: ability.description,
		license: ability.license,
		version: ability.version,
		author: ability.author,
		icon: ability.icon,
		category: ability.category,
		tags: ability.tags,
		sha256: "",
		download_count: 0,
		config: ability.config,
		detail: ability.detail,
		updated_at: syncedAt ?? "",
		origin: ability.origin,
		configVersion: ability.configVersion,
	};
}

function abilityId(ability: Pick<MarketAbility, "slug" | "type">): string {
	return `${ability.type}:${ability.slug}`;
}

function matchesInstalledOrigin(ability: OpenMarketplaceAbility, origin: GitHubMarketplaceOrigin): boolean {
	if (origin.sourceId) return ability.origin.sourceId === origin.sourceId;
	return ability.origin.repository === origin.repository && ability.origin.marketplace === origin.marketplace;
}

/**
 * 服务端默认优先；多个 GitHub 来源按来源优先级（snapshots 顺序）取第一项。
 * 已安装的 GitHub 能力锁定原来源，避免同名服务端或其它来源在刷新后静默接管升级。
 */
export function mergeAbilityCatalogs(
	serverAbilities: MarketAbility[],
	snapshots: OpenMarketplaceSourceSnapshot[],
	ledger: AbilityLedger,
): MarketAbility[] {
	const serverById = new Map<string, MarketAbility>();
	const openById = new Map<string, Array<{ ability: OpenMarketplaceAbility; syncedAt: string | null }>>();
	const orderedIds: string[] = [];
	const seenIds = new Set<string>();

	for (const ability of serverAbilities) {
		const id = abilityId(ability);
		if (!serverById.has(id)) serverById.set(id, ability);
		if (!seenIds.has(id)) {
			seenIds.add(id);
			orderedIds.push(id);
		}
	}
	for (const snapshot of snapshots) {
		for (const ability of snapshot.abilities) {
			const id = abilityId(ability);
			const candidates = openById.get(id);
			const candidate = { ability, syncedAt: snapshot.syncedAt };
			if (candidates) candidates.push(candidate);
			else openById.set(id, [candidate]);
			if (!seenIds.has(id)) {
				seenIds.add(id);
				orderedIds.push(id);
			}
		}
	}

	const merged: MarketAbility[] = [];
	for (const id of orderedIds) {
		const installedOrigin = ledger[id]?.origin;
		const candidates = openById.get(id) ?? [];
		if (installedOrigin?.kind === "github-marketplace") {
			const installedCandidate = candidates.find(({ ability }) => matchesInstalledOrigin(ability, installedOrigin));
			if (installedCandidate) merged.push(toMarketAbility(installedCandidate.ability, installedCandidate.syncedAt));
			continue;
		}
		const server = serverById.get(id);
		if (server) {
			merged.push(server);
			continue;
		}
		const firstOpen = candidates[0];
		if (firstOpen) merged.push(toMarketAbility(firstOpen.ability, firstOpen.syncedAt));
	}
	return merged;
}

export function getOpenCatalogOrigin(ability: MarketAbility): GitHubMarketplaceOrigin | undefined {
	const candidate = ability as MarketAbility & { origin?: GitHubMarketplaceOrigin };
	return candidate.origin?.kind === "github-marketplace" ? candidate.origin : undefined;
}
