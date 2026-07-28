import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MarketplaceSource, OpenMarketplaceSnapshot } from "../../../preload/api-types/abilities";
import { MarketplaceSourceStore } from "./marketplace-source-store";
import { OpenMarketplaceManager } from "./open-marketplace-manager";

const temporaryRoots: string[] = [];

async function temporaryRoot(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "vetta-marketplace-manager-test-"));
	temporaryRoots.push(root);
	return root;
}

function source(id: string, priority: number, autoUpdate = true): MarketplaceSource {
	return {
		id,
		name: id,
		type: "github",
		repository: `https://github.com/example/${id}`,
		archiveUrl: `https://github.com/example/${id}/archive/refs/heads/main.zip`,
		ref: "main",
		enabled: true,
		builtin: false,
		autoUpdate,
		priority,
		createdAt: "2026-07-28T00:00:00.000Z",
		updatedAt: "2026-07-28T00:00:00.000Z",
	};
}

function snapshot(sourceId: string): OpenMarketplaceSnapshot {
	return {
		sourceId,
		abilities: [],
		marketplaceVersion: "1.0.0",
		repository: `https://github.com/example/${sourceId}`,
		syncedAt: "2026-07-28T00:00:00.000Z",
		stale: false,
	};
}

afterEach(async () => {
	await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("OpenMarketplaceManager", () => {
	it("isolates source failures and keeps source priority order", async () => {
		const root = await temporaryRoot();
		const sources = [source("first", 100), source("broken", 200)];
		const store = new MarketplaceSourceStore({ filePath: join(root, "sources.json"), defaultSources: sources });
		const manager = new OpenMarketplaceManager({
			appVersion: "0.5.11",
			store,
			cacheRoot: join(root, "cache"),
			workerFactory: (item) => ({
				list:
					item.id === "broken"
						? vi.fn(async () => Promise.reject(new Error("offline")))
						: vi.fn(async () => snapshot(item.id)),
				listCached: vi.fn(async () => snapshot(item.id)),
				refresh: vi.fn(async () => snapshot(item.id)),
				install: vi.fn(async () => undefined),
			}),
		});

		const catalog = await manager.list();

		expect(catalog.snapshots.map((item) => item.source.id)).toEqual(["first"]);
		expect(catalog.failedSourceIds).toEqual(["broken"]);
		expect(catalog.sources.map((item) => item.id)).toEqual(["first", "broken"]);
	});

	it("uses cached data when auto update is disabled and routes installs by source", async () => {
		const root = await temporaryRoot();
		const cached = source("cached", 100, false);
		const store = new MarketplaceSourceStore({ filePath: join(root, "sources.json"), defaultSources: [cached] });
		const list = vi.fn(async () => snapshot(cached.id));
		const listCached = vi.fn(async () => snapshot(cached.id));
		const install = vi.fn(async () => undefined);
		const manager = new OpenMarketplaceManager({
			appVersion: "0.5.11",
			store,
			cacheRoot: join(root, "cache"),
			workerFactory: () => ({ list, listCached, refresh: list, install }),
		});

		await manager.list();
		await manager.install("plugin", "demo", cached.id);

		expect(list).not.toHaveBeenCalled();
		expect(listCached).toHaveBeenCalledOnce();
		expect(install).toHaveBeenCalledWith("plugin", "demo");
	});

	it("uses a different cache directory after source configuration changes", async () => {
		const root = await temporaryRoot();
		const catalog = source("catalog", 100);
		const store = new MarketplaceSourceStore({ filePath: join(root, "sources.json"), defaultSources: [catalog] });
		const cacheRoots: string[] = [];
		const manager = new OpenMarketplaceManager({
			appVersion: "0.5.11",
			store,
			cacheRoot: join(root, "cache"),
			workerFactory: (item, cacheRoot) => {
				cacheRoots.push(cacheRoot);
				return {
					list: vi.fn(async () => snapshot(item.id)),
					listCached: vi.fn(async () => snapshot(item.id)),
					refresh: vi.fn(async () => snapshot(item.id)),
					install: vi.fn(async () => undefined),
				};
			},
		});

		await manager.list();
		await manager.list();
		manager.updateSource(catalog.id, { ref: "next" });
		await manager.list();

		expect(cacheRoots).toHaveLength(2);
		expect(cacheRoots[0]).not.toBe(cacheRoots[1]);
		expect(cacheRoots[0]).toContain(join("cache", catalog.id));
		expect(cacheRoots[1]).toContain(join("cache", catalog.id));
	});

	it("publishes successful background updates to subscribers", async () => {
		const root = await temporaryRoot();
		const catalog = source("catalog", 100);
		const store = new MarketplaceSourceStore({ filePath: join(root, "sources.json"), defaultSources: [catalog] });
		let publishBackgroundUpdate: (() => void) | undefined;
		const manager = new OpenMarketplaceManager({
			appVersion: "0.5.11",
			store,
			cacheRoot: join(root, "cache"),
			workerFactory: (item, _cacheRoot, onBackgroundUpdate) => {
				publishBackgroundUpdate = onBackgroundUpdate;
				return {
					list: vi.fn(async () => snapshot(item.id)),
					listCached: vi.fn(async () => snapshot(item.id)),
					refresh: vi.fn(async () => snapshot(item.id)),
					install: vi.fn(async () => undefined),
				};
			},
		});
		const listener = vi.fn();
		const unsubscribe = manager.subscribeToUpdates(listener);
		await manager.list();

		publishBackgroundUpdate?.();

		expect(listener).toHaveBeenCalledWith(catalog.id);
		unsubscribe();
		publishBackgroundUpdate?.();
		expect(listener).toHaveBeenCalledOnce();
	});
});
