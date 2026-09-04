import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, posix, relative, resolve, sep } from "node:path";
import AdmZip from "adm-zip";
import type {
	GitHubMarketplaceOrigin,
	OpenMarketplaceAbility,
	OpenMarketplaceMcpRuntimeProgress,
	OpenMarketplaceSnapshot,
} from "../../../preload/api-types/abilities.js";
import type { McpServerConfigData } from "../../../preload/api-types/mcp.js";
import { getApplicationCacheService } from "../../cache/application-cache-service.js";
import { loadMarketplaceCatalog } from "./marketplace-catalog.js";
import { isAppVersionCompatible, isValidAppVersion } from "./marketplace-compatibility.js";
import { type MarketplaceManifest, parseMarketplaceManifest } from "./marketplace-schema.js";

export const DEFAULT_MARKETPLACE_SOURCE_ID = "vetta-official";
const STATE_SCHEMA_VERSION = 1;
const DEFAULT_SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_UPDATE_CHECK_INTERVAL_MS = 5 * 60 * 1000;
const MAX_ARCHIVE_BYTES = 25 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 2 * 1024 * 1024;
const MAX_UNCOMPRESSED_BYTES = 100 * 1024 * 1024;
const MAX_ARCHIVE_ENTRIES = 10_000;
const DOWNLOAD_TIMEOUT_MS = 15_000;

type MarketplaceSyncError = NonNullable<OpenMarketplaceSnapshot["error"]>;

class MarketplaceRequestError extends Error {
	constructor(
		readonly code: MarketplaceSyncError,
		message: string,
	) {
		super(message);
	}
}

function requestError(status: number, operation: string): MarketplaceRequestError {
	const code: MarketplaceSyncError =
		status === 401
			? "auth-required"
			: status === 403
				? "forbidden"
				: status === 404
					? "not-found"
					: status === 429
						? "rate-limited"
						: "sync-failed";
	return new MarketplaceRequestError(code, `${operation} failed: ${status}`);
}

function syncError(error: unknown): MarketplaceSyncError {
	return error instanceof MarketplaceRequestError ? error.code : "sync-failed";
}

type FetchArchive = (url: string, init?: RequestInit) => Promise<Response>;
type InstallAbility = (
	snapshotRoot: string,
	ability: MarketplaceManifest["abilities"][number],
	origin: GitHubMarketplaceOrigin,
) => Promise<void>;
type PrepareMcpAbility = (
	snapshotRoot: string,
	ability: Extract<MarketplaceManifest["abilities"][number], { type: "mcp" }>,
	sourceId: string,
	onProgress?: (progress: OpenMarketplaceMcpRuntimeProgress) => void,
) => Promise<McpServerConfigData>;
/** 返回 undefined 表示该能力没有声明安装后步骤。 */
type ReadMcpSetupStatus = (
	snapshotRoot: string,
	ability: Extract<MarketplaceManifest["abilities"][number], { type: "mcp" }>,
	sourceId: string,
) => boolean | undefined;

interface OpenMarketplaceState {
	schemaVersion: typeof STATE_SCHEMA_VERSION;
	sourceId: string;
	repository: string;
	ref: string;
	archiveUrl: string;
	marketplaceVersion: string;
	archiveSha256: string;
	syncedAt: string;
}

export interface OpenMarketplaceServiceOptions {
	appVersion: string;
	rootDir?: string;
	sourceId?: string;
	sourceRef?: string;
	archiveUrl?: string;
	repository?: string;
	fetchArchive?: FetchArchive;
	fetchManifest?: FetchArchive;
	getAccessToken?: () => string | undefined;
	now?: () => Date;
	syncIntervalMs?: number;
	updateCheckIntervalMs?: number;
	installAbility?: InstallAbility;
	prepareMcpAbility?: PrepareMcpAbility;
	readMcpSetupStatus?: ReadMcpSetupStatus;
	onBackgroundUpdate?: (snapshot: OpenMarketplaceSnapshot) => void;
	createTemporaryDirectory?: () => Promise<string>;
}

function isContained(parent: string, target: string): boolean {
	const pathFromParent = relative(parent, target);
	return (
		pathFromParent === "" ||
		(!pathFromParent.startsWith(`..${sep}`) && pathFromParent !== ".." && !isAbsolute(pathFromParent))
	);
}

function parseState(input: unknown): OpenMarketplaceState | null {
	if (input == null || typeof input !== "object" || Array.isArray(input)) return null;
	const state = input as Record<string, unknown>;
	if (
		state.schemaVersion !== STATE_SCHEMA_VERSION ||
		typeof state.sourceId !== "string" ||
		typeof state.repository !== "string" ||
		typeof state.ref !== "string" ||
		typeof state.archiveUrl !== "string" ||
		typeof state.marketplaceVersion !== "string" ||
		typeof state.archiveSha256 !== "string" ||
		typeof state.syncedAt !== "string"
	) {
		return null;
	}
	return {
		schemaVersion: STATE_SCHEMA_VERSION,
		sourceId: state.sourceId,
		repository: state.repository,
		ref: state.ref,
		archiveUrl: state.archiveUrl,
		marketplaceVersion: state.marketplaceVersion,
		archiveSha256: state.archiveSha256,
		syncedAt: state.syncedAt,
	};
}

function normalizeArchiveEntryPath(value: string): string {
	const slashPath = value.replace(/\\/g, "/");
	if (!slashPath || slashPath.includes("\0") || slashPath.startsWith("/") || /^[a-zA-Z]:\//.test(slashPath)) {
		throw new Error(`Unsafe archive path: ${value}`);
	}
	const normalized = posix.normalize(slashPath).replace(/\/$/, "");
	if (!normalized || normalized === "." || normalized === ".." || normalized.startsWith("../")) {
		throw new Error(`Unsafe archive path: ${value}`);
	}
	return normalized;
}

function marketplaceManifestUrl(repository: string, ref: string): string {
	const parsed = new URL(repository);
	const encodedRef = ref.split("/").map(encodeURIComponent).join("/");
	return `${parsed.origin}${parsed.pathname}/raw/refs/heads/${encodedRef}/.vetta/marketplace.json`;
}

function githubRepositoryCoordinates(repository: string): { owner: string; repository: string } {
	const segments = new URL(repository).pathname.split("/").filter(Boolean);
	const owner = segments[0];
	const name = segments[1];
	if (!owner || !name || segments.length !== 2) throw new Error("GitHub repository URL is invalid");
	return { owner: encodeURIComponent(owner), repository: encodeURIComponent(name) };
}

function githubManifestUrl(repository: string, ref: string): string {
	const coordinates = githubRepositoryCoordinates(repository);
	return `https://api.github.com/repos/${coordinates.owner}/${coordinates.repository}/contents/.vetta/marketplace.json?ref=${encodeURIComponent(ref)}`;
}

function githubZipballUrl(repository: string, ref: string): string {
	const coordinates = githubRepositoryCoordinates(repository);
	return `https://api.github.com/repos/${coordinates.owner}/${coordinates.repository}/zipball/${encodeURIComponent(ref)}`;
}

function githubHeaders(accept: string): Record<string, string> {
	return { Accept: accept, "User-Agent": "Vetta-Desktop" };
}

function githubApiHeaders(accept: string, token: string): Record<string, string> {
	return {
		...githubHeaders(accept),
		Authorization: `Bearer ${token}`,
		"X-GitHub-Api-Version": "2022-11-28",
	};
}

function toOpenMarketplaceAbility(
	sourceId: string,
	manifest: MarketplaceManifest,
	ability: MarketplaceManifest["abilities"][number],
	listed: boolean,
): OpenMarketplaceAbility {
	const origin: GitHubMarketplaceOrigin = {
		kind: "github-marketplace",
		sourceId,
		marketplace: manifest.name,
		marketplaceVersion: manifest.marketplaceVersion,
		repository: manifest.repository,
	};
	const meta = [...(ability.detail.meta ?? [])];
	if (!meta.some((entry) => entry.key === "repository")) {
		meta.push({ key: "repository", value: manifest.repository });
	}
	const config =
		ability.type === "bundle"
			? {
					members: ability.config.members.map((member) => {
						const target = manifest.abilities.find(
							(candidate) => candidate.type === member.type && candidate.slug === member.slug,
						);
						if (!target) throw new Error(`Bundle member not found: ${member.type}:${member.slug}`);
						return {
							type: member.type,
							slug: member.slug,
							exists: true,
							name: target.name,
							icon: target.icon,
							version: target.version,
						};
					}),
				}
			: ability.config;
	return {
		listed,
		slug: ability.slug,
		type: ability.type,
		name: ability.name,
		description: ability.description,
		license: ability.license,
		version: ability.version,
		configVersion: ability.configVersion,
		author: ability.author,
		icon: ability.icon,
		category: ability.category,
		categoryI18n: ability.categoryI18n,
		tags: ability.tags,
		config,
		detail: { ...ability.detail, meta },
		origin,
	};
}

export class OpenMarketplaceService {
	private readonly rootDir: string;
	private readonly sourceId: string;
	private readonly sourceRef: string;
	private readonly archiveUrl: string;
	private readonly repository: string;
	private readonly appVersion: string;
	private readonly fetchArchive: FetchArchive;
	private readonly fetchManifest: FetchArchive;
	private readonly getAccessToken: () => string | undefined;
	private readonly now: () => Date;
	private readonly syncIntervalMs: number;
	private readonly updateCheckIntervalMs: number;
	private readonly installAbilityOverride?: InstallAbility;
	private readonly prepareMcpAbilityOverride?: PrepareMcpAbility;
	private readonly readMcpSetupStatusOverride?: ReadMcpSetupStatus;
	private readonly onBackgroundUpdate?: (snapshot: OpenMarketplaceSnapshot) => void;
	private readonly createTemporaryDirectory: () => Promise<string>;
	private lastUpdateCheckAt: number | undefined;
	private backgroundUpdate: Promise<void> | undefined;
	private syncInFlight: Promise<OpenMarketplaceSnapshot> | undefined;
	/** 进程内快照：避免同会话反复 list 时对每个 ability 包做全量校验。 */
	private memorySnapshot: OpenMarketplaceSnapshot | undefined;

	constructor(options: OpenMarketplaceServiceOptions) {
		const marketplaceCache = getApplicationCacheService().namespace("marketplace");
		this.sourceId = options.sourceId ?? DEFAULT_MARKETPLACE_SOURCE_ID;
		this.rootDir = options.rootDir ?? marketplaceCache.path(this.sourceId);
		this.sourceRef = options.sourceRef ?? process.env.VETTA_OPEN_MARKETPLACE_REF ?? "main";
		const configuredRepository = options.repository ?? process.env.VETTA_OPEN_MARKETPLACE_REPOSITORY;
		if (!configuredRepository?.trim()) {
			throw new Error("Open marketplace repository is not configured");
		}
		this.repository = configuredRepository.trim().replace(/\/$/, "");
		this.archiveUrl =
			options.archiveUrl ??
			(options.repository ? undefined : process.env.VETTA_OPEN_MARKETPLACE_ARCHIVE_URL?.trim() || undefined) ??
			`${this.repository}/archive/refs/heads/${this.sourceRef.split("/").map(encodeURIComponent).join("/")}.zip`;
		if (!isValidAppVersion(options.appVersion)) {
			throw new Error(`Invalid desktop app version: ${options.appVersion}`);
		}
		this.appVersion = options.appVersion;
		this.fetchArchive = options.fetchArchive ?? fetch;
		this.fetchManifest = options.fetchManifest ?? fetch;
		this.getAccessToken = options.getAccessToken ?? (() => undefined);
		this.now = options.now ?? (() => new Date());
		this.syncIntervalMs = options.syncIntervalMs ?? DEFAULT_SYNC_INTERVAL_MS;
		this.updateCheckIntervalMs = options.updateCheckIntervalMs ?? DEFAULT_UPDATE_CHECK_INTERVAL_MS;
		this.installAbilityOverride = options.installAbility;
		this.prepareMcpAbilityOverride = options.prepareMcpAbility;
		this.readMcpSetupStatusOverride = options.readMcpSetupStatus;
		this.onBackgroundUpdate = options.onBackgroundUpdate;
		this.createTemporaryDirectory =
			options.createTemporaryDirectory ??
			(options.rootDir
				? () => mkdtemp(join(this.rootDir, "sync-"))
				: () => marketplaceCache.createTemporaryDirectory("sync"));
	}

	async list(): Promise<OpenMarketplaceSnapshot> {
		if (this.memorySnapshot) {
			this.scheduleBackgroundUpdate();
			return this.memorySnapshot;
		}
		const cached = await this.readCachedSnapshot();
		if (!cached) return this.refresh();
		this.memorySnapshot = cached;
		this.scheduleBackgroundUpdate();
		return cached;
	}

	async listCached(): Promise<OpenMarketplaceSnapshot> {
		if (this.memorySnapshot) return this.memorySnapshot;
		const cached = await this.readCachedSnapshot();
		if (cached) {
			this.memorySnapshot = cached;
			return cached;
		}
		return {
			sourceId: this.sourceId,
			abilities: [],
			marketplaceVersion: null,
			repository: this.repository,
			syncedAt: null,
			stale: true,
		};
	}

	async refresh(): Promise<OpenMarketplaceSnapshot> {
		try {
			const snapshot = await this.syncOnce();
			this.lastUpdateCheckAt = this.now().getTime();
			this.memorySnapshot = snapshot;
			return snapshot;
		} catch (error) {
			const cached = this.memorySnapshot ?? (await this.readCachedSnapshot());
			const errorCode = syncError(error);
			const failed = cached
				? { ...cached, stale: true, error: errorCode }
				: {
						sourceId: this.sourceId,
						abilities: [],
						marketplaceVersion: null,
						repository: this.repository,
						syncedAt: null,
						stale: true,
						error: errorCode,
					};
			this.memorySnapshot = failed;
			return failed;
		}
	}

	async install(type: "skill" | "scene" | "plugin", slug: string): Promise<void> {
		await this.ensureSnapshotFresh();
		const active = await this.readActiveMarketplace();
		if (!active) throw new Error("No validated open marketplace snapshot is available");
		const ability = active.manifest.abilities.find((entry) => entry.type === type && entry.slug === slug);
		if (!ability) throw new Error(`Open ability not found: ${type}:${slug}`);
		const installAbility =
			this.installAbilityOverride ??
			(await import("./open-marketplace-production.js")).installOpenMarketplaceAbilityInDesktop;
		await installAbility(active.snapshotRoot, ability, {
			kind: "github-marketplace",
			sourceId: this.sourceId,
			marketplace: active.manifest.name,
			marketplaceVersion: active.manifest.marketplaceVersion,
			repository: active.manifest.repository,
		});
	}

	async prepareMcp(
		slug: string,
		onProgress?: (progress: OpenMarketplaceMcpRuntimeProgress) => void,
	): Promise<McpServerConfigData> {
		await this.ensureSnapshotFresh();
		const active = await this.readActiveMarketplace();
		if (!active) throw new Error("No validated open marketplace snapshot is available");
		const ability = active.manifest.abilities.find(
			(entry): entry is Extract<MarketplaceManifest["abilities"][number], { type: "mcp" }> =>
				entry.type === "mcp" && entry.slug === slug,
		);
		if (!ability) throw new Error(`Open ability not found: mcp:${slug}`);
		const prepareMcp =
			this.prepareMcpAbilityOverride ??
			(await import("./open-marketplace-production.js")).prepareOpenMarketplaceMcpInDesktop;
		return onProgress
			? prepareMcp(active.snapshotRoot, ability, this.sourceId, onProgress)
			: prepareMcp(active.snapshotRoot, ability, this.sourceId);
	}

	/**
	 * 本源下声明了安装后步骤的 MCP 能力 → 是否已完成。未声明步骤的能力不出现在结果里。
	 * 读的是各能力数据目录里的标志文件，不触发任何下载。
	 */
	async mcpSetupStatus(): Promise<Record<string, boolean>> {
		const active = await this.readActiveMarketplace();
		if (!active) return {};
		const readStatus =
			this.readMcpSetupStatusOverride ??
			(await import("./open-marketplace-production.js")).readOpenMarketplaceMcpSetupStatusInDesktop;
		const status: Record<string, boolean> = {};
		for (const ability of active.manifest.abilities) {
			if (ability.type !== "mcp") continue;
			try {
				const completed = readStatus(active.snapshotRoot, ability, this.sourceId);
				if (completed !== undefined) status[ability.slug] = completed;
			} catch {
				// 单个包解析失败不应拖垮整张状态表；该能力按「无安装后步骤」处理。
			}
		}
		return status;
	}

	private get statePath(): string {
		return join(this.rootDir, "state.json");
	}

	private get snapshotsDir(): string {
		return join(this.rootDir, "snapshots");
	}

	private async readState(): Promise<OpenMarketplaceState | null> {
		try {
			return parseState(JSON.parse(await readFile(this.statePath, "utf-8")) as unknown);
		} catch {
			return null;
		}
	}

	private matchesCurrentSource(state: OpenMarketplaceState): boolean {
		return (
			state.sourceId === this.sourceId &&
			state.repository === this.repository &&
			state.ref === this.sourceRef &&
			state.archiveUrl === this.archiveUrl
		);
	}

	private async readActiveMarketplace(): Promise<{
		state: OpenMarketplaceState;
		snapshotRoot: string;
		manifest: MarketplaceManifest;
		listedSlugs: ReadonlySet<string>;
	} | null> {
		const state = await this.readState();
		if (!state || !this.matchesCurrentSource(state)) return null;
		const snapshotRoot = join(this.snapshotsDir, state.marketplaceVersion);
		try {
			const raw: unknown = JSON.parse(await readFile(join(snapshotRoot, ".vetta", "marketplace.json"), "utf-8"));
			const manifest = parseMarketplaceManifest(raw);
			if (manifest.marketplaceVersion !== state.marketplaceVersion) return null;
			this.assertManifestCompatible(manifest);
			const catalog = loadMarketplaceCatalog(snapshotRoot, manifest);
			return {
				state,
				snapshotRoot,
				manifest: { ...manifest, abilities: catalog.abilities },
				listedSlugs: catalog.listedSlugs,
			};
		} catch {
			return null;
		}
	}

	private assertManifestCompatible(manifest: MarketplaceManifest): void {
		if (!isAppVersionCompatible(this.appVersion, manifest.minAppVersion)) {
			throw new Error(
				`Marketplace ${manifest.marketplaceVersion} requires desktop app ${manifest.minAppVersion} or newer`,
			);
		}
	}

	private async readCachedSnapshot(): Promise<OpenMarketplaceSnapshot | null> {
		const active = await this.readActiveMarketplace();
		if (!active) return null;
		const elapsed = this.now().getTime() - Date.parse(active.state.syncedAt);
		return {
			sourceId: this.sourceId,
			abilities: active.manifest.abilities.map((ability) =>
				toOpenMarketplaceAbility(this.sourceId, active.manifest, ability, active.listedSlugs.has(ability.slug)),
			),
			marketplaceVersion: active.manifest.marketplaceVersion,
			repository: active.manifest.repository,
			syncedAt: active.state.syncedAt,
			stale: !Number.isFinite(elapsed) || elapsed >= this.syncIntervalMs,
		};
	}

	private async downloadArchive(): Promise<Buffer> {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
		try {
			const token = this.getAccessToken()?.trim();
			const response = await this.fetchArchive(
				token ? githubZipballUrl(this.repository, this.sourceRef) : this.archiveUrl,
				{
					headers: token
						? githubApiHeaders("application/vnd.github+json", token)
						: githubHeaders("application/zip"),
					// Electron's Chromium fetch cancels manual redirects. Its network stack
					// strips Authorization when following the cross-origin GitHub download redirect.
					redirect: "follow",
					signal: controller.signal,
				},
			);
			if (!response.ok) throw requestError(response.status, "Open marketplace download");
			const declaredLength = Number(response.headers.get("content-length"));
			if (Number.isFinite(declaredLength) && declaredLength > MAX_ARCHIVE_BYTES) {
				throw new Error("Open marketplace archive is too large");
			}
			const buffer = Buffer.from(await response.arrayBuffer());
			if (buffer.byteLength > MAX_ARCHIVE_BYTES) throw new Error("Open marketplace archive is too large");
			return buffer;
		} finally {
			clearTimeout(timer);
		}
	}

	private async downloadManifest(): Promise<MarketplaceManifest> {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
		try {
			const token = this.getAccessToken()?.trim();
			const response = await this.fetchManifest(
				token
					? githubManifestUrl(this.repository, this.sourceRef)
					: marketplaceManifestUrl(this.repository, this.sourceRef),
				{
					headers: token
						? githubApiHeaders("application/vnd.github+json", token)
						: githubHeaders("application/json"),
					redirect: "follow",
					signal: controller.signal,
				},
			);
			if (!response.ok) throw requestError(response.status, "Open marketplace manifest download");
			const declaredLength = Number(response.headers.get("content-length"));
			if (Number.isFinite(declaredLength) && declaredLength > MAX_MANIFEST_BYTES) {
				throw new Error("Open marketplace manifest is too large");
			}
			const text = await response.text();
			if (Buffer.byteLength(text, "utf-8") > MAX_MANIFEST_BYTES) {
				throw new Error("Open marketplace manifest is too large");
			}
			if (!token) return parseMarketplaceManifest(JSON.parse(text) as unknown);
			const payload: unknown = JSON.parse(text);
			if (payload == null || typeof payload !== "object" || Array.isArray(payload)) {
				throw new Error("GitHub manifest response is invalid");
			}
			const content = (payload as Record<string, unknown>).content;
			if (typeof content !== "string") throw new Error("GitHub manifest response has no content");
			return parseMarketplaceManifest(
				JSON.parse(Buffer.from(content.replace(/\s/g, ""), "base64").toString("utf8")) as unknown,
			);
		} finally {
			clearTimeout(timer);
		}
	}

	/**
	 * 装之前先跟源头核对一次版本。
	 *
	 * `list()` 是缓存优先的：先把旧快照给出去，再排一次后台检查，而那次检查还带
	 * {@link updateCheckIntervalMs} 节流。于是刚推上去的版本，界面上可能几分钟内都还是旧的——
	 * 用户点「安装」，装进去的是他没选的那个版本，装完立刻又被标记「有更新」。
	 * 安装是低频且明确的动作，值得为它多发一个 manifest 请求。
	 *
	 * 已有后台检查在跑就搭它的车，不重复请求；源头连不上则沿用本地快照——
	 * 离线时拿现成的快照装上，好过直接装不了。
	 */
	private async ensureSnapshotFresh(): Promise<void> {
		if (this.backgroundUpdate) {
			await this.backgroundUpdate;
			return;
		}
		const update = this.refreshInBackgroundIfChanged()
			.catch(() => undefined)
			.finally(() => {
				if (this.backgroundUpdate === update) this.backgroundUpdate = undefined;
			});
		this.backgroundUpdate = update;
		this.lastUpdateCheckAt = this.now().getTime();
		await update;
	}

	private scheduleBackgroundUpdate(): void {
		const now = this.now().getTime();
		if (
			this.backgroundUpdate ||
			(this.lastUpdateCheckAt !== undefined && now - this.lastUpdateCheckAt < this.updateCheckIntervalMs)
		) {
			return;
		}
		this.lastUpdateCheckAt = now;
		const update = this.refreshInBackgroundIfChanged()
			.catch(() => undefined)
			.finally(() => {
				if (this.backgroundUpdate === update) this.backgroundUpdate = undefined;
			});
		this.backgroundUpdate = update;
	}

	private async refreshInBackgroundIfChanged(): Promise<void> {
		const remoteManifest = await this.downloadManifest();
		this.assertManifestCompatible(remoteManifest);
		const state = await this.readState();
		if (state && this.matchesCurrentSource(state) && state.marketplaceVersion === remoteManifest.marketplaceVersion) {
			return;
		}
		const snapshot = await this.syncOnce();
		this.memorySnapshot = snapshot;
		this.onBackgroundUpdate?.(snapshot);
	}

	private async extractArchive(buffer: Buffer, targetDir: string): Promise<void> {
		const archive = new AdmZip(buffer);
		const entries = archive.getEntries();
		if (entries.length > MAX_ARCHIVE_ENTRIES) throw new Error("Open marketplace archive has too many entries");
		let uncompressedBytes = 0;
		for (const entry of entries) {
			uncompressedBytes += entry.header.size;
			if (uncompressedBytes > MAX_UNCOMPRESSED_BYTES) {
				throw new Error("Open marketplace archive expands beyond the size limit");
			}
			if ((entry.header.flags & 1) !== 0) throw new Error("Encrypted archive entries are not supported");
			const unixType = (entry.attr >>> 16) & 0o170000;
			if (unixType === 0o120000) throw new Error("Symlink archive entries are not allowed");
			const entryPath = normalizeArchiveEntryPath(entry.entryName);
			const destination = resolve(targetDir, entryPath);
			if (!isContained(targetDir, destination)) throw new Error(`Unsafe archive path: ${entry.entryName}`);
			if (entry.isDirectory) {
				await mkdir(destination, { recursive: true });
				continue;
			}
			await mkdir(dirname(destination), { recursive: true });
			await writeFile(destination, entry.getData(), { flag: "wx" });
		}
	}

	private async locateMarketplaceRoot(unpackedDir: string): Promise<string> {
		if (existsSync(join(unpackedDir, ".vetta", "marketplace.json"))) return unpackedDir;
		const entries = await readdir(unpackedDir, { withFileTypes: true });
		const candidates = entries
			.filter((entry) => entry.isDirectory())
			.map((entry) => join(unpackedDir, entry.name))
			.filter((dir) => existsSync(join(dir, ".vetta", "marketplace.json")));
		if (candidates.length !== 1) throw new Error("Archive must contain exactly one .vetta/marketplace.json");
		return candidates[0];
	}

	/** Manual and background refreshes share activation; concurrent renames would corrupt the snapshot. */
	private syncOnce(): Promise<OpenMarketplaceSnapshot> {
		if (!this.syncInFlight) {
			this.syncInFlight = this.sync().finally(() => {
				this.syncInFlight = undefined;
			});
		}
		return this.syncInFlight;
	}

	private async sync(): Promise<OpenMarketplaceSnapshot> {
		await mkdir(this.rootDir, { recursive: true });
		await mkdir(this.snapshotsDir, { recursive: true });
		const temporaryRoot = await this.createTemporaryDirectory();
		try {
			const buffer = await this.downloadArchive();
			const archiveSha256 = createHash("sha256").update(buffer).digest("hex");
			const unpackedDir = join(temporaryRoot, "unpacked");
			await mkdir(unpackedDir, { recursive: true });
			await this.extractArchive(buffer, unpackedDir);
			const marketplaceRoot = await this.locateMarketplaceRoot(unpackedDir);
			const manifestRaw: unknown = JSON.parse(
				await readFile(join(marketplaceRoot, ".vetta", "marketplace.json"), "utf-8"),
			);
			const manifest = parseMarketplaceManifest(manifestRaw);
			this.assertManifestCompatible(manifest);
			loadMarketplaceCatalog(marketplaceRoot, manifest);

			const previousState = await this.readState();
			const sameSourceState = previousState && this.matchesCurrentSource(previousState) ? previousState : null;
			if (
				sameSourceState?.marketplaceVersion === manifest.marketplaceVersion &&
				sameSourceState.archiveSha256 !== archiveSha256
			) {
				throw new Error("Marketplace content changed without a marketplaceVersion update");
			}
			const destination = join(this.snapshotsDir, manifest.marketplaceVersion);
			const canReuseDestination =
				sameSourceState?.marketplaceVersion === manifest.marketplaceVersion &&
				sameSourceState.archiveSha256 === archiveSha256 &&
				existsSync(destination);
			if (!canReuseDestination) {
				await rm(destination, { recursive: true, force: true });
				await rename(marketplaceRoot, destination);
			}
			const state: OpenMarketplaceState = {
				schemaVersion: STATE_SCHEMA_VERSION,
				sourceId: this.sourceId,
				repository: this.repository,
				ref: this.sourceRef,
				archiveUrl: this.archiveUrl,
				marketplaceVersion: manifest.marketplaceVersion,
				archiveSha256,
				syncedAt: this.now().toISOString(),
			};
			const temporaryStatePath = join(temporaryRoot, "state.json");
			await writeFile(temporaryStatePath, JSON.stringify(state, null, 2), "utf-8");
			await rename(temporaryStatePath, this.statePath);
			// presentation 中的本地图标 URL 包含绝对路径；激活后必须从正式快照目录重新解析，
			// 不能继续返回即将被 finally 删除的 temporaryRoot 路径。
			const activeSnapshot = await this.readCachedSnapshot();
			if (!activeSnapshot) throw new Error("Activated marketplace snapshot could not be read");
			return { ...activeSnapshot, stale: false };
		} finally {
			await rm(temporaryRoot, { recursive: true, force: true });
		}
	}
}

let desktopOpenMarketplaceService: OpenMarketplaceService | undefined;

export function getOpenMarketplaceService(appVersion: string): OpenMarketplaceService {
	desktopOpenMarketplaceService ??= new OpenMarketplaceService({ appVersion });
	return desktopOpenMarketplaceService;
}
