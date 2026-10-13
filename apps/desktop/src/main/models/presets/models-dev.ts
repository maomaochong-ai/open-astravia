import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { getVettaHomePath } from "@vetta/action-rpc";
import { atomicWriteJSON } from "@vetta/toolkit/atomic-write";
import type { ModelDefinition } from "../model-settings-service.js";
import { getPresetProvider } from "./catalog.js";
import type { FetchImpl } from "./fetch.js";
import { parseReleaseDate, selectCurrentModelIds } from "./model-tiers.js";
import { MODELS_DEV_SNAPSHOT } from "./models-dev-snapshot.generated.js";

/**
 * models.dev 目录:补齐各家 `/models` 不返回的元数据(价格、上下文长度、视觉/思考能力)。
 *
 * 各家的 `/models` 一律不给价格,OpenAI / DeepSeek / GLM 连上下文长度都不给。曾用手写
 * 静态表补,但各家发版一快就全错(见 ADR-0050),改为拉这份社区维护、跟各家发版更新的目录。
 * 拉不到就用磁盘缓存,再没有就只展示接口给的字段——绝不显示猜的价格。
 */

const CATALOG_URL = "https://models.dev/api.json";
const CATALOG_PATH = join(getVettaHomePath(), "agent", "models-dev-cache.json");

/**
 * 缓存结构版本。**改动 CatalogEntry / providers / lookup 的形状、目录过滤口径、或往
 * PROVIDER_KEYS / LOOKUP_PROVIDER_KEYS 里加家, 都必须 +1**——
 *
 * 磁盘缓存写在用户机器上,老版本客户端写的文件会被新代码原样读进来;
 * 没有这个版本号时,一次结构调整就让旧缓存在 TTL 内被当成有效数据,
 * 读到的条目缺字段,目录列表与后台同步一起静默失败。
 *
 * 加家同理:老缓存里没有新家的 key,而它在 TTL 内算「新鲜」,连后台刷新都不会触发,
 * 新加的预设服务商就会一直显示 0 个模型(最长 12 小时)。+1 让老缓存整份作废,
 * 先退到随包快照(已含新家)再后台重拉。
 */
const CATALOG_VERSION = 8;

/** 目录只读缓存：内存 → 磁盘 → 随包快照。进程内只读一次盘。 */
let catalogMemo: ModelsDevCatalog | null = null;
let catalogMemoLoaded = false;

/**
 * 只读目录（内存 → 磁盘缓存 → 随包快照），不碰网络。过期的也照用——过期目录远好过没有目录。
 *
 * 快照是最后一道兜底：国内网络下 models.dev 常在 TLS 阶段被直接掐断（net::ERR_CONNECTION_CLOSED），
 * 新装用户既没缓存也拉不到，没有快照就只能对着 0 个模型干瞪眼。
 */
export async function getCachedModelsDevCatalog(): Promise<ModelsDevCatalog> {
	if (!catalogMemoLoaded) {
		catalogMemo = await readCatalogCache();
		catalogMemoLoaded = true;
	}
	return catalogMemo ?? MODELS_DEV_SNAPSHOT;
}

/** 拉取成功后写回内存，避免同一次会话里再读一次盘。 */
export function rememberModelsDevCatalog(catalog: ModelsDevCatalog): void {
	catalogMemo = catalog;
	catalogMemoLoaded = true;
}

/** 拉取成功后落盘，供下次启动直接读。 */
export function writeModelsDevCatalogCache(catalog: ModelsDevCatalog): void {
	atomicWriteJSON(CATALOG_PATH, catalog);
}

async function readCatalogCache(): Promise<ModelsDevCatalog | null> {
	try {
		const cached = JSON.parse(await readFile(CATALOG_PATH, "utf8")) as ModelsDevCatalog;
		// 旧版本客户端写的缓存形状对不上,读进来会让后续解析炸在缺失字段上——直接丢弃重拉。
		return isCatalogUsable(cached) ? cached : null;
	} catch {
		return null;
	}
}
/** 目录变动按天计,12 小时一拉,与预设模型列表同步节奏一致。 */
export const CATALOG_TTL_MS = 12 * 60 * 60 * 1000;
/**
 * 缓存结构版本。**改动 CatalogEntry / providers / lookup 的形状、目录过滤口径、或往
 * PROVIDER_KEYS / LOOKUP_PROVIDER_KEYS 里加家, 都必须 +1**——

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

/**
 * 元数据查找投影覆盖的 models.dev provider。
 *
 * 与 `PROVIDER_KEYS` 不同，这些家**不用于展示**，只在网关没报参数时按 id 查元数据：
 * 各家的官方目录（与上面同一份，但按 models.dev 的 key 取），加上覆盖面最广的两个
 * 聚合家——openrouter 的 model key 是 `<厂商>/<型号>` 形状，正好对上网关给
 * `deepseek/deepseek-v4.1-flash` 这类路由 id；cline-pass 是同一形状且用户量大的家。
 *
 * 每加一家都会成比例地撑大缓存与随包快照（openrouter 一家 380 个模型、约 +35KB），
 * 加家只针对“能对上网关命名空间”的家，不要为了覆盖率把几百家全收进来。
 */
const LOOKUP_PROVIDER_KEYS: readonly string[] = [
	"anthropic",
	"openai",
	"deepseek",
	"zai",
	"moonshotai",
	"google",
	"xai",
	"alibaba",
	"openrouter",
	"cline-pass",
];

/** 查找投影里排在前面就被优先采用的家（同 id 多家命中时保证结果不随遍历顺序漂移）。 */
const LOOKUP_PROVIDER_RANK: readonly string[] = LOOKUP_PROVIDER_KEYS;

/**
 * 单个模型的元数据投影。只收“填得进模型配置”的四个字段：思考、上下文、最大输出、图片输入。
 * 价格不在这里——价格由预设那条展示口径负责。
 */
export interface CatalogLookupEntry {
	name?: string;
	reasoning?: boolean;
	reasoningLevels?: string[];
	contextWindow?: number;
	maxTokens?: number;
	vision?: boolean;
}

interface RawModel {
	name?: string;
	status?: string;
	/** 代际收敛的分组依据之一，见 model-tiers.ts；单独用它删模型仍然不行。 */
	family?: string;
	release_date?: string;
	tool_call?: boolean;
	reasoning?: boolean;
	reasoning_options?: Array<{ type?: string; values?: string[] }>;
	modalities?: { input?: string[]; output?: string[] };
	limit?: { context?: number; output?: number };
	cost?: { input?: number; output?: number; cache_read?: number; cache_write?: number };
}

/** 目录条目。状态字段只用于生成时过滤，不进入缓存。 */
export interface CatalogEntry {
	model: ModelDefinition;
	/** 上游给的发布日期(`2026-07` / `2026-07-09` 两种精度)，列表按它倒序排。 */
	releaseDate?: string;
}

/** 只保留用得上的那几家与字段——原始 api.json 有 200+ 家、5MB 出头。 */
export interface ModelsDevCatalog {
	version: number;
	fetchedAt: string;
	/** 预设标识 → 模型 id → 目录条目。展示口径：已过滤非对话模型并做代际收敛。 */
	providers: Record<string, Record<string, CatalogEntry>>;
	/** 元数据查找投影（见 `buildLookup`）。不收敛、按各家原始 model key 存，只服务 id→元数据。 */
	lookup: Record<string, Record<string, CatalogLookupEntry>>;
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
	return {
		version: CATALOG_VERSION,
		fetchedAt: new Date(now).toISOString(),
		providers: shrink(body),
		lookup: buildLookup(body),
	};
}

function shrink(body: Record<string, { models?: Record<string, RawModel> }>): ModelsDevCatalog["providers"] {
	const providers: ModelsDevCatalog["providers"] = {};
	for (const [presetId, key] of Object.entries(PROVIDER_KEYS)) {
		const models = body[key]?.models;
		if (!models) continue;
		// 代际收敛必须在非对话模型剔除之后跑:否则 gpt-realtime-2.1 这类会作为该组「最新一代」
		// 把同组的对话模型顶掉,自己再被 isChatModel 滤掉,整组就一个不剩。
		const isChatModel = getPresetProvider(presetId)?.isChatModel ?? (() => true);
		const usable = Object.entries(models).filter(([id, raw]) => {
			// models.dev 已明确标记下线的模型不再作为免 Key 的可选项展示。
			if (raw.status?.toLowerCase() === "deprecated") return false;
			if (!isChatModel(id)) return false;
			// 只留会吐文本的模型:滤掉视频(veo)、音乐(lyria)、TTS、纯图像生成等。
			// 与带 key 时 Gemini 按 generateContent 过滤的口径一致。
			return !raw.modalities?.output || raw.modalities.output.includes("text");
		});
		// 还在售但已被新一代取代的直接不收进目录(见 model-tiers.ts)。代际判定需要看到全集,
		// 所以过滤发生在这里而不是更早——不知道有哪些新模型就判不出谁旧。
		const current = selectCurrentModelIds(
			usable.map(([id, raw]) => ({
				id,
				family: raw.family,
				releaseDate: raw.release_date,
				toolCall: raw.tool_call,
			})),
		);
		const entries: Record<string, CatalogEntry> = {};
		for (const [id, raw] of usable) {
			if (!current.has(id)) continue;
			entries[id] = {
				model: toModelDefinition(id, raw),
				...(raw.release_date ? { releaseDate: raw.release_date } : {}),
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
 * 元数据查找投影。与展示口径刻意分开：
 *
 * - **不做过滤与代际收敛**。收敛是给免 Key 展示列表用的（`deepseek-v4-flash` 就被收敛掉过），
 *   而这里要的是“查得到”——网关报一个已被新一代取代的模型，也得能拿到它的上下文与档位。
 * - **保留各家原始的 model key**，所以 `openrouter` 下能看到 `deepseek/deepseek-v4.1-flash`
 *   这种带命名空间的键，正好对上网关的路由 id。
 * - 只收四个可回填字段，价格不在这里。
 */
function buildLookup(body: Record<string, { models?: Record<string, RawModel> }>): ModelsDevCatalog["lookup"] {
	const lookup: ModelsDevCatalog["lookup"] = {};
	for (const providerKey of LOOKUP_PROVIDER_KEYS) {
		const models = body[providerKey]?.models;
		if (!models) continue;
		const entries: Record<string, CatalogLookupEntry> = {};
		for (const [modelKey, raw] of Object.entries(models)) {
			const entry = toLookupEntry(raw);
			if (Object.keys(entry).length > 0) entries[modelKey] = entry;
		}
		lookup[providerKey] = entries;
	}
	return lookup;
}

function toLookupEntry(raw: RawModel): CatalogLookupEntry {
	const levels = raw.reasoning_options?.find((option) => option.type === "effort")?.values;
	const entry: CatalogLookupEntry = {};
	if (raw.name) entry.name = raw.name;
	if (raw.reasoning) entry.reasoning = true;
	if (levels?.length) entry.reasoningLevels = levels;
	if (raw.limit?.context) entry.contextWindow = raw.limit.context;
	if (raw.limit?.output) entry.maxTokens = raw.limit.output;
	if (raw.modalities?.input?.includes("image")) entry.vision = true;
	return entry;
}

/** 命中结果：哪个家、哪个 model key、以及它的元数据。 */
export interface CatalogLookupHit {
	provider: string;
	modelId: string;
	entry: CatalogLookupEntry;
}

/**
 * 把网关上报的模型 id 折算到元数据查找表里的某个条目。
 *
 * 聚合网关会在上游模型名前再叠一层自己的命名空间，层级和名字都不固定：
 * `cline-pass/deepseek-v4.1-flash`、`clinepass/cline-pass/deepseek-v4.1-flash`、
 * `xxx/cline-pass/deepseek-v4.1-flash` 指的可能都是同一个模型。所以按下面顺序找：
 *
 * 1. **原样**：先当 `<家>/<model key>` 拆（只切第一个斜杠），再把整串当某一家的 model key；
 * 2. **逐层剥掉最前面的段落**，每剥一层重复第 1 步；
 * 3. 都不中时，只在 `openrouter` 里按“model key 以 `/<后缀>` 结尾”找——网关只给裸模型名
 *    （`deepseek-v4.1-flash`）时，目录里对应的是 `deepseek/deepseek-v4.1-flash`。
 *
 * 第 1、2 步命中多家时按 `LOOKUP_PROVIDER_RANK` 取第一个，保证结果稳定。**找不到就返回 undefined**：
 * 档位会原样当作 effort 发给上游，兜底到一家随便挑的目录可能给出上游不认的档位，
 * 留空反而有 API 类型内置预设接力（见 `getModelReasoningPreset`）。
 */
export function resolveCatalogLookup(catalog: ModelsDevCatalog | null, routeId: string): CatalogLookupHit | undefined {
	if (!catalog) return undefined;
	const candidates = strippedCandidates(routeId);

	for (const candidate of candidates) {
		const slash = candidate.indexOf("/");
		if (slash > 0) {
			const provider = candidate.slice(0, slash);
			const modelId = candidate.slice(slash + 1);
			const entry = catalog.lookup[provider]?.[modelId];
			if (entry) return { provider, modelId, entry };
		}
		for (const provider of LOOKUP_PROVIDER_RANK) {
			const entry = catalog.lookup[provider]?.[candidate];
			if (entry) return { provider, modelId: candidate, entry };
		}
	}

	const openrouter = catalog.lookup.openrouter;
	if (!openrouter) return undefined;
	for (const candidate of candidates) {
		const tail = `/${candidate}`;
		for (const [modelId, entry] of Object.entries(openrouter)) {
			if (modelId.endsWith(tail)) return { provider: "openrouter", modelId, entry };
		}
	}
	return undefined;
}

/** 原 id 与逐层剥掉首段后的所有后缀（长的在前，短的在后）。 */
function strippedCandidates(routeId: string): string[] {
	const candidates: string[] = [];
	let current = routeId;
	while (current) {
		candidates.push(current);
		const slash = current.indexOf("/");
		if (slash < 0) break;
		current = current.slice(slash + 1);
	}
	return candidates;
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
 * 用目录补齐一组模型并按发布日期倒序排。模型集合以调用方为准：models.dev 只补元数据，
 * 不能再按 family、发布日期或目录命中情况删除服务商接口实际返回的模型。
 *
 * 新的排在前面：用户来选模型时想要的几乎总是最新那批，按 id 字典序排会把 gpt-6-astra
 * 甩到 gpt-5.3-codex 后面。目录里查不到日期的（服务商接口返回、目录还没收录的新模型）
 * 排在最后并按 id 排——没有日期就没有可比的依据，但它也不该插进有日期的序列里。
 */
export function enrichModelsFromCatalog(
	catalog: ModelsDevCatalog | null,
	presetId: string,
	models: ModelDefinition[],
): ModelDefinition[] {
	const releasedAt = new Map(
		models.map((model) => [model.id, parseReleaseDate(lookupCatalogModel(catalog, presetId, model.id)?.releaseDate)]),
	);
	return models
		.map((model) => enrichFromCatalog(catalog, presetId, model))
		.sort((a, b) => {
			const left = releasedAt.get(a.id) ?? Number.NaN;
			const right = releasedAt.get(b.id) ?? Number.NaN;
			if (Number.isNaN(left) !== Number.isNaN(right)) return Number.isNaN(left) ? 1 : -1;
			return (Number.isNaN(left) ? 0 : right - left) || a.id.localeCompare(b.id);
		});
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
