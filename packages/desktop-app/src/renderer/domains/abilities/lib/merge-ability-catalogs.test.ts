import type { MarketplaceSource, OpenMarketplaceAbility, OpenMarketplaceSourceSnapshot } from "@preload/api";
import type { MarketAbility } from "@shared/lib/api";
import { describe, expect, it } from "vitest";
import {
	buildMarketAbilityId,
	getMarketCatalogSource,
	getOpenCatalogOrigin,
	mergeAbilityCatalogs,
} from "./merge-ability-catalogs";

function serverAbility(slug: string): MarketAbility {
	return {
		slug,
		type: "skill",
		name: `Server ${slug}`,
		description: "",
		license: "",
		version: "1.0.0",
		author: "",
		icon: "",
		category: "",
		tags: [],
		sha256: "digest",
		download_count: 1,
		config: {},
		detail: {},
		updated_at: "",
	};
}

function openAbility(slug: string, sourceId = "official"): OpenMarketplaceAbility {
	return {
		slug,
		type: "skill",
		name: `Open ${slug}`,
		description: "",
		license: "MIT",
		version: "2.0.0",
		configVersion: 1,
		author: "",
		icon: "",
		category: "",
		tags: [],
		config: {},
		detail: {},
		origin: {
			kind: "github-marketplace",
			sourceId,
			marketplace: "vetta-open-abilities",
			marketplaceVersion: "2026.07.1",
			repository: "https://github.com/example/vetta-abilities",
		},
	};
}

function snapshot(sourceId: string, abilities: OpenMarketplaceAbility[]): OpenMarketplaceSourceSnapshot {
	const source: MarketplaceSource = {
		id: sourceId,
		name: sourceId,
		type: "github",
		repository: `https://github.com/example/${sourceId}`,
		archiveUrl: `https://github.com/example/${sourceId}/archive/refs/heads/main.zip`,
		ref: "main",
		enabled: true,
		builtin: sourceId === "official",
		autoUpdate: true,
		priority: sourceId === "official" ? 100 : 1000,
		createdAt: "2026-07-28T00:00:00.000Z",
		updatedAt: "2026-07-28T00:00:00.000Z",
	};
	return {
		sourceId,
		source,
		abilities,
		marketplaceVersion: "2026.07.1",
		repository: source.repository,
		syncedAt: "2026-07-28T00:00:00.000Z",
		stale: false,
	};
}

describe("mergeAbilityCatalogs", () => {
	it("adds GitHub abilities with their origin metadata", () => {
		const merged = mergeAbilityCatalogs([], [snapshot("official", [openAbility("demo")])]);

		expect(merged[0]).toMatchObject({ slug: "demo", download_count: 0, updated_at: "2026-07-28T00:00:00.000Z" });
		expect(getOpenCatalogOrigin(merged[0] as MarketAbility)).toMatchObject({ kind: "github-marketplace" });
		expect(getMarketCatalogSource(merged[0] as MarketAbility)).toMatchObject({
			kind: "github",
			id: "official",
			name: "official",
		});
	});

	it("preserves plugin and bundle configuration for the existing ability builders", () => {
		const plugin = {
			...openAbility("demo-plugin"),
			type: "plugin" as const,
			config: { permissions: ["storage.read"] },
		};
		const bundle = {
			...openAbility("starter-bundle"),
			type: "bundle" as const,
			config: {
				members: [
					{
						type: "plugin" as const,
						slug: "demo-plugin",
						exists: true,
						name: "Demo Plugin",
						icon: "",
						version: "2.0.0",
					},
				],
			},
		};

		const merged = mergeAbilityCatalogs([], [snapshot("official", [plugin, bundle])]);

		expect(merged.find((ability) => ability.type === "plugin")?.config.permissions).toEqual(["storage.read"]);
		expect(merged.find((ability) => ability.type === "bundle")?.config.members?.[0]).toMatchObject({
			type: "plugin",
			slug: "demo-plugin",
		});
	});

	it("keeps server and GitHub entries when type and slug conflict", () => {
		const merged = mergeAbilityCatalogs([serverAbility("demo")], [snapshot("official", [openAbility("demo")])]);

		expect(merged).toHaveLength(2);
		expect(merged[0]?.name).toBe("Server demo");
		expect(getOpenCatalogOrigin(merged[0] as MarketAbility)).toBeUndefined();
		expect(merged[1]?.name).toBe("Open demo");
		expect(buildMarketAbilityId(merged[0] as MarketAbility)).toBe("server:server:skill:demo");
		expect(buildMarketAbilityId(merged[1] as MarketAbility)).toBe("github:official:skill:demo");
	});

	it("keeps every GitHub source when multiple sources contain the same ability", () => {
		const merged = mergeAbilityCatalogs(
			[],
			[
				snapshot("official", [openAbility("demo", "official")]),
				snapshot("community", [openAbility("demo", "community")]),
			],
		);

		expect(getOpenCatalogOrigin(merged[0] as MarketAbility)?.sourceId).toBe("official");
		expect(getOpenCatalogOrigin(merged[1] as MarketAbility)?.sourceId).toBe("community");
	});
});
