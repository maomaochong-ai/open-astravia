import type { ModelDefinition } from "../model-settings-service.js";
import type { FetchImpl } from "./fetch.js";

/**
 * models.dev 目录:补齐各家 `/models` 不返回的元数据(价格、上下文长度、视觉/思考能力)。
 *
 * 各家的 `/models` 一律不给价格,OpenAI / DeepSeek / GLM 连上下文长度都不给。曾用手写
 * 静态表补,但各家发版一快就全错(见 ADR-0050),改为拉这份社区维护、跟各家发版更新的目录。
 * 拉不到就用磁盘缓存,再没有就只展示接口给的字段——绝不显示猜的价格。
 */

const CATALOG_URL = "https://models.dev/api.json";
/** 目录变动按天计,12 小时一拉,与预设模型列表同步节奏一致。 */
export const CATALOG_TTL_MS = 12 * 60 * 60 * 1000;
/**
 * 缓存结构版本。**改动 CatalogEntry / providers 的形状、或往 PROVIDER_KEYS 里加家,都必须 +1**——
 * 磁盘缓存写在用户机器上,老版本客户端写的文件会被新代码原样读进来;
 * 没有这个版本号时,一次结构调整就让旧缓存在 TTL 内被当成有效数据,
 * 读到的条目缺字段,目录列表与后台同步一起静默失败。
 *
 * 加家同理:老缓存里没有新家的 key,而它在 TTL 内算「新鲜」,连后台刷新都不会触发,
 * 新加的预设服务商就会一直显示 0 个模型(最长 12 小时)。+1 让老缓存整份作废,
 * 先退到随包快照(已含新家)再后台重拉。
 */
const CATALOG_VERSION = 3;

/** 预设标识 → models.dev 的 provider key。 */
const PROVIDER_KEYS: Record<string, string> = {
	claude: "anthropic",
	openai: "openai",
	deepseek: "deepseek",
	zai: "zai",
	kimi: "moonshotai",
	gemini: "google",
	grok: "xai",
	// 千问走国际站 endpoint,目录也取国际站那份(国内站是 alibaba-cn,模型清单不同)。
	qwen: "alibaba",
};

interface RawModel {
	name?: string;
	reasoning?: boolean;
	reasoning_options?: Array<{ type?: string; values?: string[] }>;
	modalities?: { input?: string[]; output?: string[] };
	limit?: { context?: number; output?: number };
	cost?: { input?: number; output?: number; cache_read?: number; cache_write?: number };
	family?: string;
	release_date?: string;
}

/** 目录条目:模型元数据 + 用于「只保留最新一档」的分组信息。 */
export interface CatalogEntry {
	model: ModelDefinition;
	/** 同一系列共用的族名(如 claude-opus / gpt-sol),用于折叠历史版本。 */
	family?: string;
	/** 发布日期,归一化到 YYYY-MM-DD(目录里偶尔只给到月份)。 */
	releaseDate?: string;
}

/** 只保留预设那几家、只保留用得上的字段——原始 api.json 有 170+ 家、3MB 出头。 */
export interface ModelsDevCatalog {
	version: number;
	fetchedAt: string;
	/** 预设标识 → 模型 id → 目录条目。 */
	providers: Record<string, Record<string, CatalogEntry>>;
}

/** 版本不符(旧客户端写的缓存)一律视为不可用,重新拉取。 */
export function isCatalogUsable(catalog: ModelsDevCatalog | null): boolean {
	return catalog?.version === CATALOG_VERSION;
}

export function isCatalogFresh(catalog: ModelsDevCatalog | null, now: number): boolean {
	if (!isCatalogUsable(catalog) || !catalog) return false;
	const fetchedAt = Date.parse(catalog.fetchedAt);
	return Number.isFinite(fetchedAt) && now - fetchedAt < CATALOG_TTL_MS;
}

export async function fetchModelsDevCatalog(
	fetchImpl: FetchImpl,
	now: number,
	signal?: AbortSignal,
): Promise<ModelsDevCatalog> {
	const response = await fetchImpl(CATALOG_URL, {
		method: "GET",
		signal,
		headers: { Accept: "application/json" },
	});
	if (!response.ok) throw new Error(`models.dev 返回 ${response.status} ${response.statusText}`);
	const body = (await response.json()) as Record<string, { models?: Record<string, RawModel> }>;
	return buildCatalog(body, now);
}

/** 由 models.dev 原始 api.json 折算成目录。生成内置快照的脚本也走这里,口径必须一致。 */
export function buildCatalog(
	body: Record<string, { models?: Record<string, RawModel> }>,
	now: number,
): ModelsDevCatalog {
	return { version: CATALOG_VERSION, fetchedAt: new Date(now).toISOString(), providers: shrink(body) };
}

function shrink(body: Record<string, { models?: Record<string, RawModel> }>): ModelsDevCatalog["providers"] {
	const providers: ModelsDevCatalog["providers"] = {};
	for (const [presetId, key] of Object.entries(PROVIDER_KEYS)) {
		const models = body[key]?.models;
		if (!models) continue;
		const entries: Record<string, CatalogEntry> = {};
		for (const [id, raw] of Object.entries(models)) {
			// 只留会吐文本的模型:滤掉视频(veo)、音乐(lyria)、TTS、纯图像生成等。
			// 与带 key 时 Gemini 按 generateContent 过滤的口径一致。
			if (raw.modalities?.output && !raw.modalities.output.includes("text")) continue;
			entries[id] = {
				model: toModelDefinition(id, raw),
				...(raw.family ? { family: raw.family } : {}),
				...(normalizeReleaseDate(raw.release_date) ? { releaseDate: normalizeReleaseDate(raw.release_date) } : {}),
			};
		}
		providers[presetId] = entries;
	}
	return providers;
}

function toModelDefinition(id: string, raw: RawModel): ModelDefinition {
	const levels = raw.reasoning_options?.find((option) => option.type === "effort")?.values;
	const input = raw.modalities?.input?.filter((modality) => modality === "text" || modality === "image");
	const cost = raw.cost;
	return {
		id,
		...(raw.name ? { name: raw.name } : {}),
		...(raw.reasoning === undefined ? {} : { reasoning: raw.reasoning }),
		...(raw.reasoning && levels?.length ? { reasoningLevels: levels } : {}),
		...(input?.length ? { input } : {}),
		...(raw.limit?.context ? { contextWindow: raw.limit.context } : {}),
		...(raw.limit?.output ? { maxTokens: raw.limit.output } : {}),
		...(cost?.input === undefined
			? {}
			: {
					cost: {
						input: cost.input,
						output: cost.output ?? 0,
						cacheRead: cost.cache_read ?? 0,
						cacheWrite: cost.cache_write ?? 0,
					},
				}),
	};
}

/**
 * 目录里查某个模型。先精确匹配,再去掉 `-YYYYMMDD` 日期后缀,最后退化为最长前缀匹配
 * (各家常有 `-latest` / `-preview` / 日期变体,共享同一份定价)。
 */
export function lookupCatalogModel(
	catalog: ModelsDevCatalog | null,
	presetId: string,
	modelId: string,
): CatalogEntry | undefined {
	const models = catalog?.providers[presetId];
	if (!models) return undefined;
	const exact = models[modelId];
	if (exact) return exact;
	const undated = modelId.replace(/-\d{8}$/, "");
	if (undated !== modelId && models[undated]) return models[undated];
	let best: CatalogEntry | undefined;
	let bestLength = 0;
	for (const [id, entry] of Object.entries(models)) {
		if (id.length > bestLength && undated.startsWith(id)) {
			best = entry;
			bestLength = id.length;
		}
	}
	return best;
}

/** 目录里的日期偶尔只给到月份(如 "2026-01"),补成当月 1 号好做字符串比较。 */
function normalizeReleaseDate(value: string | undefined): string | undefined {
	if (!value) return undefined;
	return /^\d{4}-\d{2}$/.test(value) ? `${value}-01` : value;
}

/** 「只保留最新一档」的时间下限:一年前发布的整族一并淘汰。 */
export const LATEST_MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000;

/**
 * 每个系列(family)只保留发布日期最新的一档,且该档需在近一年内发布。
 *
 * 各家 `/models` 会把历年模型全列出来(OpenAI 38 个、Gemini 22 个),绝大多数是没人再用的
 * 历史版本。按目录的 family + release_date 折叠,不写死任何型号,新模型上线自动顶替旧的。
 *
 * 目录里查不到的模型一律保留——那通常是刚发布还没进目录、或该账号专属的模型,
 * 宁可多留也不能把用户真正能用的新模型藏掉。
 */
export function selectLatestModels(
	catalog: ModelsDevCatalog | null,
	presetId: string,
	models: ModelDefinition[],
	now: number,
): ModelDefinition[] {
	const cutoff = new Date(now - LATEST_MAX_AGE_MS).toISOString().slice(0, 10);
	const newestByFamily = new Map<string, { id: string; releaseDate: string }>();
	const unknown: ModelDefinition[] = [];
	const known = new Map<string, ModelDefinition>();

	for (const model of models) {
		const entry = lookupCatalogModel(catalog, presetId, model.id);
		if (!entry) {
			unknown.push(model);
			continue;
		}
		const releaseDate = entry.releaseDate ?? "";
		if (releaseDate && releaseDate < cutoff) continue;
		known.set(model.id, model);
		const family = entry.family ?? entry.model.id;
		const current = newestByFamily.get(family);
		if (!current || releaseDate > current.releaseDate) {
			newestByFamily.set(family, { id: model.id, releaseDate });
		}
	}

	const kept = [...newestByFamily.values()]
		.map(({ id }) => known.get(id))
		.filter((model): model is ModelDefinition => model !== undefined);
	return [...kept, ...unknown].sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * 用目录补齐接口没给的字段。接口给了的一律以接口为准(它最清楚自己开了什么),
 * 价格只能来自目录——查不到就不带价格,不猜。
 */
export function enrichFromCatalog(
	catalog: ModelsDevCatalog | null,
	presetId: string,
	model: ModelDefinition,
): ModelDefinition {
	const meta = lookupCatalogModel(catalog, presetId, model.id)?.model;
	return {
		...model,
		...(model.name === undefined && meta?.name !== undefined ? { name: meta.name } : {}),
		...(model.reasoning === undefined && meta?.reasoning !== undefined ? { reasoning: meta.reasoning } : {}),
		...(model.reasoningLevels === undefined && meta?.reasoningLevels !== undefined
			? { reasoningLevels: meta.reasoningLevels }
			: {}),
		input: model.input ?? meta?.input ?? ["text"],
		...(model.contextWindow === undefined && meta?.contextWindow !== undefined
			? { contextWindow: meta.contextWindow }
			: {}),
		...(model.maxTokens === undefined && meta?.maxTokens !== undefined ? { maxTokens: meta.maxTokens } : {}),
		...(meta?.cost ? { cost: meta.cost } : {}),
	};
}
