import { createHash } from "node:crypto";
import { join } from "node:path";
import type {
	AddMarketplaceSourceInput,
	MarketplaceSource,
	OpenMarketplaceCatalog,
	OpenMarketplaceSnapshot,
	OpenMarketplaceSourceSnapshot,
	UpdateMarketplaceSourceInput,
} from "../../../preload/api-types/abilities.js";
import { getApplicationCacheService } from "../../cache/application-cache-service.js";
import { MarketplaceSourceStore } from "./marketplace-source-store.js";
import { DEFAULT_MARKETPLACE_SOURCE_ID, OpenMarketplaceService } from "./open-marketplace-service.js";

interface MarketplaceWorker {
	list(): Promise<OpenMarketplaceSnapshot>;
	listCached(): Promise<OpenMarketplaceSnapshot>;
	refresh(): Promise<OpenMarketplaceSnapshot>;
	install(type: "skill" | "scene" | "plugin", slug: string): Promise<void>;
}

type MarketplaceWorkerFactory = (
	source: MarketplaceSource,
	cacheRoot: string,
	onBackgroundUpdate: () => void,
) => MarketplaceWorker;

export interface OpenMarketplaceManagerOptions {
	appVersion: string;
	store?: MarketplaceSourceStore;
	cacheRoot?: string;
	workerFactory?: MarketplaceWorkerFactory;
}

export class OpenMarketplaceManager {
	private readonly store: MarketplaceSourceStore;
	private readonly cacheRoot: string;
	private readonly workerFactory: MarketplaceWorkerFactory;
	private readonly workers = new Map<string, { fingerprint: string; worker: MarketplaceWorker }>();
	private readonly updateListeners = new Set<(sourceId: string) => void>();

	constructor(options: OpenMarketplaceManagerOptions) {
		const marketplaceCache = getApplicationCacheService().namespace("marketplace");
		this.store = options.store ?? new MarketplaceSourceStore();
		this.cacheRoot = options.cacheRoot ?? marketplaceCache.rootDir;
		this.workerFactory =
			options.workerFactory ??
			((source, cacheRoot, onBackgroundUpdate) =>
				new OpenMarketplaceService({
					rootDir: cacheRoot,
					sourceId: source.id,
					sourceRef: source.ref,
					repository: source.repository,
					archiveUrl: source.archiveUrl,
					appVersion: options.appVersion,
					onBackgroundUpdate,
					createTemporaryDirectory: options.cacheRoot
						? undefined
						: () => marketplaceCache.createTemporaryDirectory("sync"),
				}));
	}

	subscribeToUpdates(listener: (sourceId: string) => void): () => void {
		this.updateListeners.add(listener);
		return () => this.updateListeners.delete(listener);
	}

	listSources(): MarketplaceSource[] {
		return this.store.list();
	}

	addSource(input: AddMarketplaceSourceInput): MarketplaceSource {
		return this.store.add(input);
	}

	updateSource(id: string, input: UpdateMarketplaceSourceInput): MarketplaceSource {
		const source = this.store.update(id, input);
		this.workers.delete(id);
		return source;
	}

	removeSource(id: string): void {
		this.store.remove(id);
		this.workers.delete(id);
	}

	async list(): Promise<OpenMarketplaceCatalog> {
		return this.collect(false);
	}

	async refresh(): Promise<OpenMarketplaceCatalog> {
		return this.collect(true);
	}

	async listSource(id: string, forceRefresh = false): Promise<OpenMarketplaceSourceSnapshot> {
		const source = this.requireSource(id);
		const worker = this.workerFor(source);
		const snapshot = forceRefresh
			? await worker.refresh()
			: source.autoUpdate
				? await worker.list()
				: await worker.listCached();
		return { ...snapshot, source };
	}

	async refreshSource(id: string): Promise<OpenMarketplaceSourceSnapshot> {
		return this.listSource(id, true);
	}

	async install(
		type: "skill" | "scene" | "plugin",
		slug: string,
		sourceId = DEFAULT_MARKETPLACE_SOURCE_ID,
	): Promise<void> {
		const source = this.requireSource(sourceId);
		if (!source.enabled) throw new Error(`Marketplace source is disabled: ${sourceId}`);
		await this.workerFor(source).install(type, slug);
	}

	private async collect(forceRefresh: boolean): Promise<OpenMarketplaceCatalog> {
		const sources = this.store.list();
		const enabled = sources.filter((source) => source.enabled).sort((a, b) => a.priority - b.priority);
		const settled = await Promise.allSettled(
			enabled.map(async (source) => {
				const worker = this.workerFor(source);
				const snapshot = forceRefresh
					? await worker.refresh()
					: source.autoUpdate
						? await worker.list()
						: await worker.listCached();
				return { ...snapshot, source } satisfies OpenMarketplaceSourceSnapshot;
			}),
		);
		const snapshots: OpenMarketplaceSourceSnapshot[] = [];
		const failedSourceIds: string[] = [];
		for (const [index, result] of settled.entries()) {
			const source = enabled[index];
			if (!source) continue;
			if (result.status === "rejected") {
				failedSourceIds.push(source.id);
				continue;
			}
			snapshots.push(result.value);
			if (result.value.error) failedSourceIds.push(source.id);
		}
		return {
			sources,
			snapshots,
			abilities: snapshots.flatMap((snapshot) => snapshot.abilities),
			failedSourceIds,
		};
	}

	private requireSource(id: string): MarketplaceSource {
		const source = this.store.list().find((item) => item.id === id);
		if (!source) throw new Error(`Marketplace source not found: ${id}`);
		return source;
	}

	private workerFor(source: MarketplaceSource): MarketplaceWorker {
		const fingerprint = `${source.repository}\n${source.archiveUrl}\n${source.ref}`;
		const existing = this.workers.get(source.id);
		if (existing?.fingerprint === fingerprint) return existing.worker;
		const cacheRoot = join(this.cacheRoot, source.id, createHash("sha256").update(fingerprint).digest("hex"));
		const worker = this.workerFactory(source, cacheRoot, () => {
			for (const listener of this.updateListeners) listener(source.id);
		});
		this.workers.set(source.id, { fingerprint, worker });
		return worker;
	}
}

let desktopOpenMarketplaceManager: OpenMarketplaceManager | undefined;

export function getOpenMarketplaceManager(appVersion: string): OpenMarketplaceManager {
	desktopOpenMarketplaceManager ??= new OpenMarketplaceManager({ appVersion });
	return desktopOpenMarketplaceManager;
}
