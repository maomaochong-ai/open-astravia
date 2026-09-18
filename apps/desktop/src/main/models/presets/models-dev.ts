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
 * 缓存结构版本。**改动 CatalogEntry / providers 的形状、目录过滤口径、或往 PROVIDER_KEYS 里加家,
 * 都必须 +1**——
 * 磁盘缓存写在用户机器上,老版本客户端写的文件会被新代码原样读进来;
 * 没有这个版本号时,一次结构调整就让旧缓存在 TTL 内被当成有效数据,
 * 读到的条目缺字段,目录列表与后台同步一起静默失败。
 *
 * 加家同理:老缓存里没有新家的 key,而它在 TTL 内算「新鲜」,连后台刷新都不会触发,
 * 新加的预设服务商就会一直显示 0 个模型(最长 12 小时)。+1 让老缓存整份作废,
 * 先退到随包快照(已含新家)再后台重拉。
 */
const CATALOG_VERSION = 4;

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
	status?: string;
	/** 仅用于兼容上游形状；不同产品档位可能共用 family，不能据此删模型。 */
	family?: string;
	reasoning?: boolean;
	reasoning_options?: Array<{ type?: string; values?: string[] }>;
	modalities?: { input?: string[]; output?: string[] };
	limit?: { context?: number; output?: number };
	cost?: { input?: number; output?: number; cache_read?: number; cache_write?: number };
}

/** 目录条目。状态字段只用于生成时过滤，不进入缓存。 */
export interface CatalogEntry {
	model: ModelDefinition;
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
			// models.dev 已明确标记下线的模型不再作为免 Key 的可选项展示。
			if (raw.status?.toLowerCase() === "deprecated") continue;
			// 只留会吐文本的模型:滤掉视频(veo)、音乐(lyria)、TTS、纯图像生成等。
			// 与带 key 时 Gemini 按 generateContent 过滤的口径一致。
			if (raw.modalities?.output && !raw.modalities.output.includes("text")) continue;
			entries[id] = { model: toModelDefinition(id, raw) };
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

/**
 * 用目录补齐一组模型并按 id 排序。模型集合以调用方为准：models.dev 只补元数据，
 * 不能再按 family、发布日期或目录命中情况删除服务商接口实际返回的模型。
 */
export function enrichModelsFromCatalog(
	catalog: ModelsDevCatalog | null,
	presetId: string,
	models: ModelDefinition[],
): ModelDefinition[] {
	return models.map((model) => enrichFromCatalog(catalog, presetId, model)).sort((a, b) => a.id.localeCompare(b.id));
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
