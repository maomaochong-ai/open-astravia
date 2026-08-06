import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { getVettaHomePath } from "@vetta/action-rpc";
import { atomicWriteJSON } from "@vetta/toolkit/atomic-write";
import { BrowserWindow, net } from "electron";
import { getAppLogger } from "../../logger.js";
import { getDesktopModelSettingsService } from "../model-settings-host.js";
import type { ModelDefinition, ModelsConfig } from "../model-settings-service.js";
import { getPresetProvider, PRESET_PROVIDERS, type PresetProviderDef } from "./catalog.js";
import { type PresetError, toPresetError } from "./errors.js";
import { fetchPresetModels, type PresetModelsResult } from "./fetch.js";
import {
	enrichFromCatalog,
	fetchModelsDevCatalog,
	isCatalogFresh,
	isCatalogUsable,
	type ModelsDevCatalog,
	selectLatestModels,
} from "./models-dev.js";
import { MODELS_DEV_SNAPSHOT } from "./models-dev-snapshot.generated.js";

const presetLog = getAppLogger("preset-providers");

const FETCH_TIMEOUT_MS = 15_000;
const CATALOG_PATH = join(getVettaHomePath(), "agent", "models-dev-cache.json");
/** 后台同步间隔:12 小时。上游模型目录变动没那么快,再密就是白烧流量。 */
const AUTO_SYNC_INTERVAL_MS = 12 * 60 * 60 * 1000;

/** 下发给渲染层的预设目录条目(内置,不含 key)。 */
export interface PresetProviderInfo {
	id: string;
	displayName: string;
	api: string;
	baseUrl: string;
	icon: string;
	/** 公共目录里该家的模型(免 key 可见)。填 key 后由账号实际可用的 /models 结果取代。 */
	catalogModels: ModelDefinition[];
}

export interface PresetProvidersResult {
	providers: PresetProviderInfo[];
	/** 公共目录最近一次拉取失败的原因。仅在退到随包快照时给出——有实拉数据就不打扰。 */
	catalogError?: PresetError;
	/** 当前目录数据来自哪里,便于排查「模型怎么和线上对不上」。 */
	catalogSource: "live" | "snapshot";
	/** 当前目录数据的抓取时间(ISO)。 */
	catalogFetchedAt?: string;
}

/**
 * 预设服务商目录。模型清单来自 models.dev(公开、免 key),让用户填 key 前就能看到
 * 各家有什么、多少钱;拉不到目录则模型为空——不内置任何会腐烂的默认清单。
 *
 * **只读缓存,绝不在这里等网络**:设置页每次打开都会调它,让 UI 干等一次 3MB 下载
 * (目录不可达时还要等满超时)是不可接受的。缓存过期时在后台刷新,拉到了广播给渲染层。
 */
export async function listPresetProviders(): Promise<PresetProvidersResult> {
	const catalog = await getCachedCatalog();
	if (!isCatalogFresh(catalog, Date.now())) void refreshCatalogInBackground();
	const snapshot = isSnapshot(catalog);
	return {
		catalogSource: snapshot ? "snapshot" : "live",
		catalogFetchedAt: catalog?.fetchedAt,
		// 只有退到快照且确实拉失败过才提示:平时用快照(还没轮到刷新)不该报错。
		...(snapshot && catalogLastError ? { catalogError: catalogLastError } : {}),
		providers: PRESET_PROVIDERS.map((def) => ({
			id: def.id,
			displayName: def.displayName,
			api: def.api,
			baseUrl: def.baseUrl,
			icon: def.icon,
			catalogModels: catalogModelsFor(catalog, def),
		})),
	};
}

function catalogModelsFor(catalog: ModelsDevCatalog | null, def: PresetProviderDef): ModelDefinition[] {
	const entries = catalog?.providers[def.id];
	if (!entries) return [];
	const models = Object.values(entries)
		.filter((entry) => def.isChatModel(entry.model.id))
		.map((entry) => enrichFromCatalog(catalog, def.id, entry.model))
		.sort((a, b) => a.id.localeCompare(b.id));
	return selectLatestModels(catalog, def.id, models, Date.now());
}

/**
 * 手动刷新公共目录:清掉失败冷却强制重拉,把真实错误原样回给渲染层。
 * 目录拉不到时用户只能看到 0 个模型,必须有一条能自助重试并看到原因的路径。
 */
export async function refreshPresetCatalog(): Promise<{
	ok: boolean;
	error?: PresetError;
	elapsedMs: number;
	modelCount: number;
}> {
	catalogRetryAfter = 0;
	const started = Date.now();
	const catalog = await ensureCatalog(true);
	const elapsed = Date.now() - started;
	const modelCount = catalog
		? Object.values(catalog.providers).reduce((sum, models) => sum + Object.keys(models).length, 0)
		: 0;
	if (!catalog || catalogLastError) {
		const error = catalogLastError ?? { code: "network" as const };
		presetLog.warn(`手动刷新 models.dev 目录失败（${elapsed}ms）：${error.code} ${error.detail ?? ""}`);
		return { ok: false, error, elapsedMs: elapsed, modelCount };
	}
	presetLog.info(`手动刷新 models.dev 目录成功（${elapsed}ms，${modelCount} 个模型）`);
	return { ok: true, elapsedMs: elapsed, modelCount };
}

/**
 * 后台刷新目录,拿到新数据后广播给渲染层——设置页据此重新列一遍,
 * 不必让用户盯着 0 个模型手动重试。
 */
async function refreshCatalogInBackground(): Promise<void> {
	const before = catalogMemo;
	const catalog = await ensureCatalog();
	if (!catalog || catalog === before) return;
	for (const win of BrowserWindow.getAllWindows()) {
		if (!win.isDestroyed()) win.webContents.send("vetta:models:presets-updated");
	}
}

/** 进程内缓存,避免同一次同步里六家各拉一遍 3MB 的目录。 */
let catalogMemo: ModelsDevCatalog | null = null;
/** 单飞:并发调用共用同一次网络请求。 */
let catalogInFlight: Promise<ModelsDevCatalog | null> | null = null;
/** 失败退避的截止时刻。目录不可达时反复重试只会让每次开设置页都卡满超时。 */
let catalogRetryAfter = 0;
let catalogLastError: PresetError | null = null;

/** 拉取失败后的冷却时间。 */
const CATALOG_RETRY_COOLDOWN_MS = 10 * 60 * 1000;

async function readCatalogCache(): Promise<ModelsDevCatalog | null> {
	try {
		const cached = JSON.parse(await readFile(CATALOG_PATH, "utf8")) as ModelsDevCatalog;
		// 旧版本客户端写的缓存形状对不上,读进来会让后续解析炸在缺失字段上——直接丢弃重拉。
		return isCatalogUsable(cached) ? cached : null;
	} catch {
		return null;
	}
}

/**
 * 只读本地目录(内存 → 磁盘缓存 → 随包快照),不碰网络。过期的也照用——过期目录远好过没有目录。
 *
 * 快照是最后一道兜底:国内网络下 models.dev 常在 TLS 阶段被直接掐断(net::ERR_CONNECTION_CLOSED),
 * 新装用户既没缓存也拉不到,没有快照就只能对着 0 个模型干瞪眼。
 */
async function getCachedCatalog(): Promise<ModelsDevCatalog | null> {
	catalogMemo ??= await readCatalogCache();
	return catalogMemo ?? MODELS_DEV_SNAPSHOT;
}

/**
 * 取 models.dev 目录,必要时走网络。缓存还新鲜就直接用;过期或没有才拉,
 * 拉失败退回旧缓存并进入冷却——目录不可达时不能让每次调用都干等一次超时。
 *
 * `force` 供用户手动刷新用:此时缓存新鲜也要重拉,否则「刷新目录」按钮在 TTL 内是空操作,
 * 目录内容变了(比如新增了预设服务商)只能干等 12 小时。
 */
async function ensureCatalog(force = false): Promise<ModelsDevCatalog | null> {
	const now = Date.now();
	const cached = await getCachedCatalog();
	if (!force && isCatalogFresh(cached, now)) return cached;
	if (!force && now < catalogRetryAfter) return cached;
	if (catalogInFlight) return catalogInFlight;

	catalogInFlight = (async () => {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
		try {
			const fresh = await fetchModelsDevCatalog(net.fetch, now, controller.signal);
			catalogMemo = fresh;
			catalogLastError = null;
			atomicWriteJSON(CATALOG_PATH, fresh);
		} catch (err) {
			catalogRetryAfter = Date.now() + CATALOG_RETRY_COOLDOWN_MS;
			catalogLastError = toPresetError(err, FETCH_TIMEOUT_MS);
			presetLog.warn("拉取 models.dev 目录失败，改用缓存：", err);
		} finally {
			clearTimeout(timer);
			catalogInFlight = null;
		}
		// 拉失败时同样退到快照,别让下游拿着 null 去补元数据(那会连价格都没有)。
		return catalogMemo ?? MODELS_DEV_SNAPSHOT;
	})();
	return catalogInFlight;
}

/** 用的是不是随包快照——快照的 fetchedAt 是生成时刻,与实拉数据一模一样,只能按引用认。 */
function isSnapshot(catalog: ModelsDevCatalog | null): boolean {
	return catalog === MODELS_DEV_SNAPSHOT;
}

/**
 * 拉取某预设服务商的模型列表,并用 models.dev 目录补齐价格/上下文等接口不返回的字段。
 * 只读不写——由渲染层拿到结果后连同 key 一起落盘,避免主进程与渲染层各写一次 models.json。
 *
 * apiKey 缺省时读 models.json 里已保存的 key(手动刷新场景)。
 */
export async function refreshPresetModels(providerId: string, apiKey?: string): Promise<PresetModelsResult> {
	const def = getPresetProvider(providerId);
	if (!def) return { models: [], error: { code: "unknown-provider", params: { provider: providerId } } };

	let key = apiKey?.trim();
	if (!key) {
		const config = await getDesktopModelSettingsService().getConfig();
		key = config.providers[providerId]?.apiKey?.trim();
	}
	if (!key) return { models: [], error: { code: "missing-key" } };

	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
	let result: PresetModelsResult;
	try {
		result = await fetchPresetModels(def, key, net.fetch, controller.signal, FETCH_TIMEOUT_MS);
	} finally {
		clearTimeout(timer);
	}
	if (result.models.length === 0) return result;

	const catalog = await ensureCatalog();
	const enriched = result.models.map((model) => enrichFromCatalog(catalog, def.id, model));
	const models = selectLatestModels(catalog, def.id, enriched, Date.now());
	return { ...result, models };
}

/** models.json 里由预设采纳而来、且填了 key 的条目。 */
function adoptedPresetIds(config: ModelsConfig): string[] {
	return Object.entries(config.providers)
		.filter(([id, provider]) => {
			if (provider.source !== "template") return false;
			if (!provider.apiKey?.trim()) return false;
			return Boolean(getPresetProvider(provider.templateId ?? id));
		})
		.map(([id]) => id);
}

/**
 * 后台同步所有已启用的预设服务商的模型列表并写回 models.json。
 * 单个失败静默跳过(保留本地快照),不影响其它服务商。
 */
export async function syncAdoptedPresets(): Promise<void> {
	// 先热一遍公共目录:即便一家都没启用,设置页也要能免 key 列出各家模型。
	await ensureCatalog();
	const service = getDesktopModelSettingsService();
	const config = await service.getConfig();
	const ids = adoptedPresetIds(config);
	if (ids.length === 0) return;

	const results = await Promise.all(
		ids.map(async (id) => {
			const templateId = config.providers[id]?.templateId ?? id;
			const result = await refreshPresetModels(templateId, config.providers[id]?.apiKey);
			return { id, result };
		}),
	);

	// 重新读一次:同步期间渲染层可能改过配置,不能拿旧快照整体覆盖。
	const latest = await service.getConfig();
	let changed = false;
	const syncedAt = new Date().toISOString();
	for (const { id, result } of results) {
		const provider = latest.providers[id];
		if (!provider || provider.source !== "template") continue;
		if (result.error || result.models.length === 0) {
			presetLog.warn(
				`同步预设服务商 ${id} 模型失败：${result.error?.code ?? "empty"} ${result.error?.detail ?? ""}`,
			);
			continue;
		}
		latest.providers[id] = { ...provider, models: result.models, modelsSyncedAt: syncedAt };
		changed = true;
	}
	if (changed) await service.replaceConfig(latest);
}

/** 启动时同步一次,之后每 12 小时一次。返回清理函数。 */
export function startPresetModelsAutoSync(): () => void {
	const run = (): void => {
		void syncAdoptedPresets().catch((err) => {
			presetLog.warn("预设模型自动同步失败：", err);
		});
	};
	run();
	const timer = setInterval(run, AUTO_SYNC_INTERVAL_MS);
	return () => clearInterval(timer);
}
