import type { GitHubMarketplaceOrigin, OpenMarketplaceAbility, OpenMarketplaceSourceSnapshot } from "@preload/api";
import type { MarketAbility } from "@shared/lib/api";
import type { AbilityCatalogSource } from "../types";

export type OpenCatalogMarketAbility = MarketAbility & {
	origin: GitHubMarketplaceOrigin;
	configVersion: number;
	catalogSource: Extract<AbilityCatalogSource, { kind: "github" }>;
};

export type CatalogMarketAbility = MarketAbility & {
	catalogSource: AbilityCatalogSource;
};

function toMarketAbility(
	ability: OpenMarketplaceAbility,
	snapshot: OpenMarketplaceSourceSnapshot,
): OpenCatalogMarketAbility {
	return {
		slug: ability.slug,
		type: ability.type,
		name: ability.name,
		description: ability.description,
		license: ability.license,
		version: ability.version,
		author: ability.author,
		icon: ability.icon,
		// 开放市场清单只有一个分类名，没有译名块——分组头对这类条目直接显示原名
		category: ability.category,
		tags: ability.tags,
		sha256: "",
		download_count: 0,
		config: ability.config,
		detail: ability.detail,
		updated_at: snapshot.syncedAt ?? "",
		origin: ability.origin,
		configVersion: ability.configVersion,
		catalogSource: {
			kind: "github",
			id: snapshot.sourceId,
			name: snapshot.source.name,
			repository: snapshot.repository,
		},
	};
}

function toServerMarketAbility(ability: MarketAbility): CatalogMarketAbility {
	return {
		...ability,
		catalogSource: { kind: "server", id: "server" },
	};
}

export function getMarketCatalogSource(ability: MarketAbility): AbilityCatalogSource {
	const candidate = ability as Partial<CatalogMarketAbility>;
	return candidate.catalogSource ?? { kind: "server", id: "server" };
}

export function buildMarketAbilityId(ability: Pick<MarketAbility, "slug" | "type">): string {
	const source = getMarketCatalogSource(ability as MarketAbility);
	return `${source.kind}:${source.id}:${ability.type}:${ability.slug}`;
}

/**
 * 服务端与每个 GitHub 来源都保留独立目录行。
 * 来源优先级只决定展示顺序，不再用于覆盖同 type + slug 的其它来源。
 */
export function mergeAbilityCatalogs(
	serverAbilities: MarketAbility[],
	snapshots: OpenMarketplaceSourceSnapshot[],
): MarketAbility[] {
	const merged: MarketAbility[] = serverAbilities.map(toServerMarketAbility);
	for (const snapshot of snapshots) {
		for (const ability of snapshot.abilities) {
			merged.push(toMarketAbility(ability, snapshot));
		}
	}
	return merged;
}

export function getOpenCatalogOrigin(ability: MarketAbility): GitHubMarketplaceOrigin | undefined {
	const candidate = ability as MarketAbility & { origin?: GitHubMarketplaceOrigin };
	return candidate.origin?.kind === "github-marketplace" ? candidate.origin : undefined;
}
