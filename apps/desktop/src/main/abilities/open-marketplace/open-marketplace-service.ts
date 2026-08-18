import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, posix, relative, resolve, sep } from "node:path";
import AdmZip from "adm-zip";
import type {
	GitHubMarketplaceOrigin,
	OpenMarketplaceAbility,
	OpenMarketplaceSnapshot,
} from "../../../preload/api-types/abilities.js";
import { getApplicationCacheService } from "../../cache/application-cache-service.js";
import { isAppVersionCompatible, isValidAppVersion } from "./marketplace-compatibility.js";
import { type MarketplaceManifest, marketplaceDetailSchema, parseMarketplaceManifest } from "./marketplace-schema.js";
import { validateOpenMarketplaceMcp } from "./open-marketplace-mcp.js";
import { validateOpenMarketplacePlugin } from "./open-marketplace-plugin.js";
import { loadOpenMarketplacePresentation } from "./open-marketplace-presentation.js";
import { validateSkillPackage } from "./skill-package.js";

export const DEFAULT_MARKETPLACE_SOURCE_ID = "vetta-official";
const STATE_SCHEMA_VERSION = 1;
const DEFAULT_SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_UPDATE_CHECK_INTERVAL_MS = 5 * 60 * 1000;
const MAX_ARCHIVE_BYTES = 25 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 2 * 1024 * 1024;
const MAX_UNCOMPRESSED_BYTES = 100 * 1024 * 1024;
const MAX_ARCHIVE_ENTRIES = 10_000;
const DOWNLOAD_TIMEOUT_MS = 15_000;

type FetchArchive = (url: string, init?: RequestInit) => Promise<Response>;
type InstallAbility = (
	snapshotRoot: string,
	ability: MarketplaceManifest["abilities"][number],
	origin: GitHubMarketplaceOrigin,
) => Promise<void>;

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
	now?: () => Date;
	syncIntervalMs?: number;
	updateCheckIntervalMs?: number;
	installAbility?: InstallAbility;
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

function toOpenMarketplaceAbility(
	sourceId: string,
	manifest: MarketplaceManifest,
	ability: MarketplaceManifest["abilities"][number],
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
							...member,
							exists: true,
							name: target.name,
							icon: target.icon,
							version: target.version,
						};
					}),
				}
			: ability.config;
	return {
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
	private readonly now: () => Date;
	private readonly syncIntervalMs: number;
	private readonly updateCheckIntervalMs: number;
	private readonly installAbilityOverride?: InstallAbility;
	private readonly onBackgroundUpdate?: (snapshot: OpenMarketplaceSnapshot) => void;
	private readonly createTemporaryDirectory: () => Promise<string>;
	private lastUpdateCheckAt: number | undefined;
	private backgroundUpdate: Promise<void> | undefined;
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
			(options.repository ? undefined : process.env.VETTA_OPEN_MARKETPLACE_ARCHIVE_URL) ??
			`${this.repository}/archive/refs/heads/${this.sourceRef.split("/").map(encodeURIComponent).join("/")}.zip`;
		if (!isValidAppVersion(options.appVersion)) {
			throw new Error(`Invalid desktop app version: ${options.appVersion}`);
		}
		this.appVersion = options.appVersion;
		this.fetchArchive = options.fetchArchive ?? fetch;
		this.fetchManifest = options.fetchManifest ?? fetch;
		this.now = options.now ?? (() => new Date());
		this.syncIntervalMs = options.syncIntervalMs ?? DEFAULT_SYNC_INTERVAL_MS;
		this.updateCheckIntervalMs = options.updateCheckIntervalMs ?? DEFAULT_UPDATE_CHECK_INTERVAL_MS;
		this.installAbilityOverride = options.installAbility;
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
			const snapshot = await this.sync();
			this.lastUpdateCheckAt = this.now().getTime();
			this.memorySnapshot = snapshot;
			return snapshot;
		} catch {
			const cached = this.memorySnapshot ?? (await this.readCachedSnapshot());
			const failed = cached
				? { ...cached, stale: true, error: "sync-failed" as const }
				: {
						sourceId: this.sourceId,
						abilities: [],
						marketplaceVersion: null,
						repository: this.repository,
						syncedAt: null,
						stale: true,
						error: "sync-failed" as const,
					};
			this.memorySnapshot = failed;
			return failed;
		}
	}

	async install(type: "skill" | "scene" | "plugin", slug: string): Promise<void> {
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
	} | null> {
		const state = await this.readState();
		if (!state || !this.matchesCurrentSource(state)) return null;
		const snapshotRoot = join(this.snapshotsDir, state.marketplaceVersion);
		try {
			const raw: unknown = JSON.parse(await readFile(join(snapshotRoot, ".vetta", "marketplace.json"), "utf-8"));
			const manifest = parseMarketplaceManifest(raw);
			if (manifest.marketplaceVersion !== state.marketplaceVersion) return null;
			this.assertManifestCompatible(manifest);
			this.validateAbilityPackages(snapshotRoot, manifest);
			return { state, snapshotRoot, manifest };
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

	private validateAbilityPackages(marketplaceRoot: string, manifest: MarketplaceManifest): void {
		for (const ability of manifest.abilities) {
			const source = ability.source;
			if (!source) continue;
			const sourceDir = resolve(marketplaceRoot, source.path);
			if (!isContained(marketplaceRoot, sourceDir)) {
				throw new Error(`Unsafe ability source: ${source.path}`);
			}
			if (ability.type === "mcp") {
				ability.config = validateOpenMarketplaceMcp(sourceDir, ability);
			} else if (ability.type === "plugin") {
				ability.config = validateOpenMarketplacePlugin(sourceDir, ability);
			} else if (ability.type !== "bundle") {
				validateSkillPackage(sourceDir, ability);
			}
			const presentation = loadOpenMarketplacePresentation(sourceDir, ability, manifest.marketplaceVersion);
			if (presentation) {
				ability.icon = presentation.icon ?? ability.icon;
				ability.detail = marketplaceDetailSchema.parse({
					...ability.detail,
					...presentation.detail,
					icon: presentation.icon ?? ability.detail.icon,
					i18n: {
						...(ability.detail.i18n ?? {}),
						...(presentation.detail.i18n ?? {}),
					},
				});
			}
		}
	}

	private async readCachedSnapshot(): Promise<OpenMarketplaceSnapshot | null> {
		const active = await this.readActiveMarketplace();
		if (!active) return null;
		const elapsed = this.now().getTime() - Date.parse(active.state.syncedAt);
		return {
			sourceId: this.sourceId,
			abilities: active.manifest.abilities.map((ability) =>
				toOpenMarketplaceAbility(this.sourceId, active.manifest, ability),
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
			const response = await this.fetchArchive(this.archiveUrl, {
				headers: { Accept: "application/zip", "User-Agent": "Vetta-Desktop" },
				redirect: "follow",
				signal: controller.signal,
			});
			if (!response.ok) throw new Error(`Open marketplace download failed: ${response.status}`);
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
			const response = await this.fetchManifest(marketplaceManifestUrl(this.repository, this.sourceRef), {
				headers: { Accept: "application/json", "User-Agent": "Vetta-Desktop" },
				redirect: "follow",
				signal: controller.signal,
			});
			if (!response.ok) throw new Error(`Open marketplace manifest download failed: ${response.status}`);
			const declaredLength = Number(response.headers.get("content-length"));
			if (Number.isFinite(declaredLength) && declaredLength > MAX_MANIFEST_BYTES) {
				throw new Error("Open marketplace manifest is too large");
			}
			const text = await response.text();
			if (Buffer.byteLength(text, "utf-8") > MAX_MANIFEST_BYTES) {
				throw new Error("Open marketplace manifest is too large");
			}
			return parseMarketplaceManifest(JSON.parse(text) as unknown);
		} finally {
			clearTimeout(timer);
		}
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
		const snapshot = await this.sync();
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
			this.validateAbilityPackages(marketplaceRoot, manifest);

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
