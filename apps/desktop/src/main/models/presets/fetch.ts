import type { ModelDefinition } from "../model-settings-service.js";
import type { PresetProviderDef } from "./catalog.js";
import { type PresetError, PresetFetchError, toPresetError } from "./errors.js";

/** 注入的 fetch 实现——运行时传 electron 的 net.fetch,测试里传桩。 */
export type FetchImpl = (url: string, init?: RequestInit) => Promise<Response>;

export interface PresetModelsResult {
	models: ModelDefinition[];
	error?: PresetError;
}

/** 多页拉取的上限,防止上游 token 循环把主进程拖死。 */
const MAX_PAGES = 10;

/**
 * 按预设服务商各自的 `/models` 接口拉取可用模型。只解析接口自己给的字段;
 * 价格、上下文长度等缺失元数据由调用方经 models.dev 目录补齐(见 models-dev.ts)。
 * 任一步失败都返回 `{ models: [], error }`,由调用方决定是保留旧快照还是提示用户。
 */
export async function fetchPresetModels(
	def: PresetProviderDef,
	apiKey: string,
	fetchImpl: FetchImpl,
	signal?: AbortSignal,
	timeoutMs = 15_000,
): Promise<PresetModelsResult> {
	try {
		const raw = await fetchByAdapter(def, apiKey, fetchImpl, signal);
		const models = raw.filter((model) => def.isChatModel(model.id)).sort((a, b) => a.id.localeCompare(b.id));
		if (models.length === 0) return { models: [], error: { code: "empty-models" } };
		return { models };
	} catch (err) {
		return { models: [], error: toPresetError(err, timeoutMs) };
	}
}

function fetchByAdapter(
	def: PresetProviderDef,
	apiKey: string,
	fetchImpl: FetchImpl,
	signal?: AbortSignal,
): Promise<ModelDefinition[]> {
	switch (def.fetcher) {
		case "anthropic":
			return fetchAnthropicModels(def.baseUrl, apiKey, fetchImpl, signal);
		case "gemini":
			return fetchGeminiModels(def.baseUrl, apiKey, fetchImpl, signal);
		default:
			return fetchOpenAICompatibleModels(def.baseUrl, apiKey, fetchImpl, signal);
	}
}

function trimSlash(url: string): string {
	return url.replace(/\/$/, "");
}

/**
 * 读响应体,非 2xx 抛结构化错误。
 *
 * `authStatuses` 是该家「这把 key 不行」的状态码——各家不统一:Anthropic / OpenAI 兼容
 * 用 401/403,Gemini 的无效 key 返回 400 INVALID_ARGUMENT。命中就报 invalid-key,
 * 调用方据此拒绝启用,而不是笼统的「拉取失败」。
 */
async function readJson(response: Response, url: string, authStatuses: readonly number[]): Promise<unknown> {
	if (!response.ok) {
		const host = new URL(url).host;
		if (authStatuses.includes(response.status)) {
			throw new PresetFetchError({ code: "invalid-key", params: { host, status: response.status } });
		}
		throw new PresetFetchError({
			code: "http-status",
			params: { host, status: response.status, statusText: response.statusText },
		});
	}
	return response.json();
}

/** 认证失败的状态码:Bearer / x-api-key 系一律 401/403。 */
const AUTH_STATUSES = [401, 403] as const;
/** Gemini 走 ?key= 查询参数,key 不对返回 400 INVALID_ARGUMENT。 */
const GEMINI_AUTH_STATUSES = [400, 401, 403] as const;

// ─── Anthropic: GET /v1/models,x-api-key 鉴权,游标分页,元数据最全 ───

interface AnthropicCapability {
	supported?: boolean;
}

interface AnthropicModel {
	id?: string;
	display_name?: string;
	max_input_tokens?: number;
	max_tokens?: number;
	capabilities?: {
		image_input?: AnthropicCapability;
		thinking?: AnthropicCapability;
		effort?: Record<string, AnthropicCapability | boolean | undefined>;
	};
}

/** effort 能力位里的等级名(其余是 supported 等非等级字段)。 */
const EFFORT_LEVELS = ["low", "medium", "high", "xhigh", "max"];

export function parseAnthropicModel(raw: AnthropicModel): ModelDefinition | null {
	if (!raw.id) return null;
	const capabilities = raw.capabilities;
	const levels = EFFORT_LEVELS.filter((level) => {
		const value = capabilities?.effort?.[level];
		return typeof value === "object" ? value?.supported === true : value === true;
	});
	const reasoning = capabilities?.thinking?.supported;
	return {
		id: raw.id,
		...(raw.display_name ? { name: raw.display_name } : {}),
		...(reasoning === undefined ? {} : { reasoning }),
		...(reasoning && levels.length > 0 ? { reasoningLevels: levels } : {}),
		...(capabilities?.image_input === undefined
			? {}
			: { input: capabilities.image_input.supported ? ["text", "image"] : ["text"] }),
		...(raw.max_input_tokens ? { contextWindow: raw.max_input_tokens } : {}),
		...(raw.max_tokens ? { maxTokens: raw.max_tokens } : {}),
	};
}

async function fetchAnthropicModels(
	baseUrl: string,
	apiKey: string,
	fetchImpl: FetchImpl,
	signal?: AbortSignal,
): Promise<ModelDefinition[]> {
	const models: ModelDefinition[] = [];
	let afterId: string | undefined;
	for (let page = 0; page < MAX_PAGES; page++) {
		const url = `${trimSlash(baseUrl)}/v1/models?limit=1000${afterId ? `&after_id=${encodeURIComponent(afterId)}` : ""}`;
		const response = await fetchImpl(url, {
			method: "GET",
			signal,
			headers: {
				Accept: "application/json",
				"x-api-key": apiKey,
				"anthropic-version": "2023-06-01",
			},
		});
		const body = (await readJson(response, url, AUTH_STATUSES)) as {
			data?: AnthropicModel[];
			has_more?: boolean;
			last_id?: string;
		};
		for (const item of body.data ?? []) {
			const model = parseAnthropicModel(item);
			if (model) models.push(model);
		}
		if (!body.has_more || !body.last_id) break;
		afterId = body.last_id;
	}
	return models;
}

// ─── OpenAI 兼容: GET {baseUrl}/models,Bearer 鉴权 ───
// OpenAI / DeepSeek / Z.ai 只给 id;Kimi 额外给 context_length / supports_* 能力位。

interface OpenAICompatibleModel {
	id?: string;
	display_name?: string;
	context_length?: number;
	max_context_length?: number;
	supports_image_in?: boolean;
	supports_reasoning?: boolean;
}

export function parseOpenAICompatibleModel(raw: OpenAICompatibleModel | string): ModelDefinition | null {
	if (typeof raw === "string") return raw ? { id: raw } : null;
	if (!raw.id) return null;
	const contextWindow = raw.context_length ?? raw.max_context_length;
	return {
		id: raw.id,
		...(raw.display_name ? { name: raw.display_name } : {}),
		...(raw.supports_reasoning === undefined ? {} : { reasoning: raw.supports_reasoning }),
		...(raw.supports_image_in === undefined ? {} : { input: raw.supports_image_in ? ["text", "image"] : ["text"] }),
		...(contextWindow ? { contextWindow } : {}),
	};
}

async function fetchOpenAICompatibleModels(
	baseUrl: string,
	apiKey: string,
	fetchImpl: FetchImpl,
	signal?: AbortSignal,
): Promise<ModelDefinition[]> {
	const url = `${trimSlash(baseUrl)}/models`;
	const response = await fetchImpl(url, {
		method: "GET",
		signal,
		headers: { Accept: "application/json", Authorization: `Bearer ${apiKey}` },
	});
	const body = (await readJson(response, url, AUTH_STATUSES)) as { data?: unknown; models?: unknown };
	const list = Array.isArray(body.data) ? body.data : Array.isArray(body.models) ? body.models : [];
	const models: ModelDefinition[] = [];
	for (const item of list) {
		const model = parseOpenAICompatibleModel(item as OpenAICompatibleModel | string);
		if (model) models.push(model);
	}
	return models;
}

// ─── Gemini: GET {baseUrl}/models?key=,pageToken 分页,带上下文长度与 thinking ───

interface GeminiModel {
	name?: string;
	displayName?: string;
	inputTokenLimit?: number;
	outputTokenLimit?: number;
	thinking?: boolean;
	supportedGenerationMethods?: string[];
}

export function parseGeminiModel(raw: GeminiModel): ModelDefinition | null {
	if (!raw.name) return null;
	// 只保留能走 generateContent 的对话模型,滤掉 embedding / tuning 等。
	const methods = raw.supportedGenerationMethods;
	if (methods && !methods.includes("generateContent")) return null;
	return {
		id: raw.name.replace(/^models\//, ""),
		...(raw.displayName ? { name: raw.displayName } : {}),
		...(raw.thinking === undefined ? {} : { reasoning: raw.thinking }),
		...(raw.inputTokenLimit ? { contextWindow: raw.inputTokenLimit } : {}),
		...(raw.outputTokenLimit ? { maxTokens: raw.outputTokenLimit } : {}),
	};
}

async function fetchGeminiModels(
	baseUrl: string,
	apiKey: string,
	fetchImpl: FetchImpl,
	signal?: AbortSignal,
): Promise<ModelDefinition[]> {
	const models: ModelDefinition[] = [];
	let pageToken: string | undefined;
	for (let page = 0; page < MAX_PAGES; page++) {
		const url =
			`${trimSlash(baseUrl)}/models?pageSize=1000&key=${encodeURIComponent(apiKey)}` +
			`${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`;
		const response = await fetchImpl(url, {
			method: "GET",
			signal,
			headers: { Accept: "application/json" },
		});
		const body = (await readJson(response, url, GEMINI_AUTH_STATUSES)) as {
			models?: GeminiModel[];
			nextPageToken?: string;
		};
		for (const item of body.models ?? []) {
			const model = parseGeminiModel(item);
			if (model) models.push(model);
		}
		if (!body.nextPageToken) break;
		pageToken = body.nextPageToken;
	}
	return models;
}
