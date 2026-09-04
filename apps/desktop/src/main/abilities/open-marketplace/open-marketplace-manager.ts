import { createHash } from "node:crypto";
import { join } from "node:path";
import type {
	AddMarketplaceSourceInput,
	MarketplaceSource,
	OpenMarketplaceCatalog,
	OpenMarketplaceMcpRuntimeProgress,
	OpenMarketplaceSnapshot,
	OpenMarketplaceSourceSnapshot,
	UpdateMarketplaceSourceInput,
} from "../../../preload/api-types/abilities.js";
import type { McpServerConfigData } from "../../../preload/api-types/mcp.js";
import { getApplicationCacheService } from "../../cache/application-cache-service.js";
import {
	type GitHubMarketplaceCredentialStore,
	getGitHubMarketplaceCredentialStore,
} from "./github-marketplace-credentials.js";
import { MarketplaceSourceStore } from "./marketplace-source-store.js";
import { DEFAULT_MARKETPLACE_SOURCE_ID, OpenMarketplaceService } from "./open-marketplace-service.js";

interface MarketplaceWorker {
	list(): Promise<OpenMarketplaceSnapshot>;
	listCached(): Promise<OpenMarketplaceSnapshot>;
	refresh(): Promise<OpenMarketplaceSnapshot>;
	install(type: "skill" | "scene" | "plugin", slug: string): Promise<void>;
	prepareMcp(
		slug: string,
		onProgress?: (progress: OpenMarketplaceMcpRuntimeProgress) => void,
	): Promise<McpServerConfigData>;
	mcpSetupStatus(): Promise<Record<string, boolean>>;
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
	credentialStore?: GitHubMarketplaceCredentialStore;
}

export class OpenMarketplaceManager {
	private readonly store: MarketplaceSourceStore;
	private readonly cacheRoot: string;
	private readonly workerFactory: MarketplaceWorkerFactory;
	private readonly credentialStore: GitHubMarketplaceCredentialStore;
	private readonly workers = new Map<string, { fingerprint: string; worker: MarketplaceWorker }>();
	private readonly updateListeners = new Set<(sourceId: string) => void>();

	constructor(options: OpenMarketplaceManagerOptions) {
		const marketplaceCache = getApplicationCacheService().namespace("marketplace");
		this.store = options.store ?? new MarketplaceSourceStore();
		this.credentialStore = options.credentialStore ?? getGitHubMarketplaceCredentialStore();
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
					getAccessToken: () => this.readCredential(source.id),
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
		return this.store.list().map((source) => this.withCredentialState(source));
	}

	addSource(input: AddMarketplaceSourceInput): MarketplaceSource {
		const source = this.store.add(input);
		try {
			if (input.credential?.trim()) this.credentialStore.set(source.id, input.credential);
			return this.withCredentialState(source);
		} catch (error) {
			this.store.remove(source.id);
			throw error;
		}
	}

	updateSource(id: string, input: UpdateMarketplaceSourceInput): MarketplaceSource {
		// workerFor replaces workers only when their cache identity changes, preserving in-flight syncs.
		const source = this.store.update(id, input);
		if (input.credential?.trim()) this.credentialStore.set(id, input.credential);
		return this.withCredentialState(source);
	}

	removeSource(id: string): void {
		this.store.remove(id);
		this.workers.delete(id);
		this.credentialStore.remove(id);
	}

	clearSourceCredential(id: string): void {
		this.requireSource(id);
		this.credentialStore.remove(id);
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
		return { ...snapshot, source: this.withCredentialState(source) };
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

	async prepareMcp(
		slug: string,
		sourceId = DEFAULT_MARKETPLACE_SOURCE_ID,
		onProgress?: (progress: OpenMarketplaceMcpRuntimeProgress) => void,
	): Promise<McpServerConfigData> {
		const source = this.requireSource(sourceId);
		if (!source.enabled) throw new Error(`Marketplace source is disabled: ${sourceId}`);
		const worker = this.workerFor(source);
		return onProgress ? worker.prepareMcp(slug, onProgress) : worker.prepareMcp(slug);
	}

	/**
	 * 各源里声明了安装后步骤的 MCP 能力的完成情况，键为 `sourceId:slug`。
	 * 只读本地标志文件，禁用的源直接跳过。
	 */
	async mcpSetupStatus(): Promise<Record<string, boolean>> {
		const status: Record<string, boolean> = {};
		for (const source of this.store.list()) {
			if (!source.enabled) continue;
			try {
				for (const [slug, completed] of Object.entries(await this.workerFor(source).mcpSetupStatus())) {
					status[`${source.id}:${slug}`] = completed;
				}
			} catch {
				// 单个源读不出来时保留其它源的结果
			}
		}
		return status;
	}

	async removeMcpRuntime(slug: string, sourceId = DEFAULT_MARKETPLACE_SOURCE_ID): Promise<void> {
		const { removeOpenMarketplaceMcpRuntimeInDesktop } = await import("./open-marketplace-production.js");
		await removeOpenMarketplaceMcpRuntimeInDesktop(sourceId, slug);
	}

	private async collect(forceRefresh: boolean): Promise<OpenMarketplaceCatalog> {
		const storedSources = this.store.list();
		const sources = storedSources.map((source) => this.withCredentialState(source));
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

	private readCredential(sourceId: string): string | undefined {
		return this.credentialStore.get(sourceId);
	}

	private withCredentialState(source: MarketplaceSource): MarketplaceSource {
		return this.credentialStore.has(source.id) ? { ...source, credentialConfigured: true } : source;
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
