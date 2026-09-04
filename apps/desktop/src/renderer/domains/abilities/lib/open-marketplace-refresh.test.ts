import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import AdmZip from "adm-zip";
import type { TFunction } from "i18next";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MarketplaceSourceStore } from "@/main/abilities/open-marketplace/marketplace-source-store";
import { OpenMarketplaceManager } from "@/main/abilities/open-marketplace/open-marketplace-manager";
import { OpenMarketplaceService } from "@/main/abilities/open-marketplace/open-marketplace-service";
import { queryAbilityCatalog } from "./ability-catalog-query";
import { buildMcpAbilities } from "./build-ability-items";
import { mergeAbilityCatalogs } from "./merge-ability-catalogs";

const roots: string[] = [];
const repository = "https://github.com/example/official-marketplace";
const t = ((key: string) => key) as unknown as TFunction<"settings">;

function archive(includeX: boolean): Response {
	const abilities = [
		{ type: "mcp", slug: "existing-mcp", name: "Existing MCP", version: "1.0.0", source: { path: "existing" } },
		...(includeX
			? [{ type: "mcp", slug: "x-api-mcp", name: "X API", version: "1.0.0", source: { path: "x-api" } }]
			: []),
	];
	const zip = new AdmZip();
	zip.addFile(
		"market/.vetta/marketplace.json",
		Buffer.from(
			JSON.stringify({
				schemaVersion: 1,
				name: "official-marketplace",
				marketplaceVersion: includeX ? "2026.08.30-4" : "2026.08.30-3",
				repository,
				minAppVersion: "0.5.49",
				abilities,
			}),
		),
	);
	for (const ability of abilities) {
		zip.addFile(
			`market/${ability.source.path}/mcp.json`,
			Buffer.from(
				JSON.stringify({
					schemaVersion: 1,
					slug: ability.slug,
					version: ability.version,
					server: { type: "http", url: "https://api.example/mcp" },
				}),
			),
		);
	}
	return new Response(new Uint8Array(zip.toBuffer()), { headers: { "content-type": "application/zip" } });
}

beforeEach(() => {
	vi.stubEnv("VETTA_CLOUD_ENABLED", "true");
	vi.stubEnv("VETTA_BUILD_ENV", "development");
	vi.stubEnv("VETTA_OPEN_MARKETPLACE_REPOSITORY", repository);
	vi.stubEnv("VETTA_OPEN_MARKETPLACE_REF", "main");
	vi.stubEnv("VETTA_OPEN_MARKETPLACE_ARCHIVE_URL", undefined);
});

afterEach(async () => {
	vi.unstubAllEnvs();
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Desktop GitHub marketplace refresh", () => {
	it("loads GitHub sources into an empty cloud catalog and shows newly published MCP cards after refresh", async () => {
		const root = await mkdtemp(join(tmpdir(), "vetta-marketplace-refresh-test-"));
		roots.push(root);
		const filePath = join(root, "sources.json");
		await writeFile(filePath, JSON.stringify({ version: 1, sources: [] }));
		let includeX = false;
		let offline = false;
		const manager = new OpenMarketplaceManager({
			appVersion: "0.5.49",
			store: new MarketplaceSourceStore({ filePath }),
			cacheRoot: join(root, "cache"),
			workerFactory: (source, cacheRoot, onBackgroundUpdate) =>
				new OpenMarketplaceService({
					appVersion: "0.5.49",
					rootDir: cacheRoot,
					sourceId: source.id,
					repository: source.repository,
					archiveUrl: source.archiveUrl,
					onBackgroundUpdate,
					fetchArchive: async (url) => {
						expect(url).toBe(`${repository}/archive/refs/heads/main.zip`);
						if (offline) throw new Error("offline");
						return archive(includeX);
					},
					fetchManifest: async () => {
						throw new Error("No background check expected");
					},
				}),
		});

		expect((await manager.list()).abilities.map((ability) => ability.slug)).toEqual(["existing-mcp"]);
		includeX = true;
		const refreshed = await manager.refresh();
		expect(refreshed.failedSourceIds).toEqual([]);
		expect(refreshed.snapshots[0]?.marketplaceVersion).toBe("2026.08.30-4");
		const items = buildMcpAbilities(
			mergeAbilityCatalogs([], refreshed.snapshots),
			{
				ledger: {},
				skillManifest: {},
				localSkills: [],
				plugins: [],
				mcpConfig: { mcpServers: {} },
				oauthAuthByName: {},
				mcpSetupStatus: {},
				busyIds: new Set<string>(),
			},
			t,
		);
		const page = queryAbilityCatalog(items, { scope: "discover", keyword: "X API", page: 1, pageSize: 60 });
		expect(page.items).toMatchObject([{ slug: "x-api-mcp", title: "X API", installed: false }]);
		expect(page.total).toBe(1);
		expect((await manager.list()).abilities.map((ability) => ability.slug)).toEqual(["existing-mcp", "x-api-mcp"]);

		offline = true;
		const fallback = await manager.refresh();
		expect(fallback.failedSourceIds).toEqual(["vetta-official"]);
		expect(fallback.abilities.map((ability) => ability.slug)).toEqual(["existing-mcp", "x-api-mcp"]);
	});
});
