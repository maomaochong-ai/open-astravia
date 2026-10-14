import type { FetchedProviderModel } from "../../preload/api-types/models.js";
import { type ModelsDevCatalog, resolveCatalogLookup } from "./presets/models-dev.js";

/**
 * 用 models.dev 目录补齐网关 `/models` 没报的参数。
 *
 * 各家自建/聚合网关对 `/models` 的丰富程度差别很大：Ollama 只给 id，migpie 这类会带上
 * 上下文、模态与思考档位，官方家（OpenAI / DeepSeek / GLM）往往只给 id。缺什么就查目录补，
 * 与「预设服务商」共用同一份目录与 id 匹配规则（见 `resolveCatalogLookup`）。
 *
 * **只填接口没给的字段**：网关最清楚自己开了什么，它说了的一律以它为准；查不到就留空——
 * 档位会被原样当作 effort 发给上游，猜一个可能不存在的档位比留空更糟，留空还有 API 类型
 * 内置预设接力（`getModelReasoningPreset`）。
 */
export function enrichFetchedModels(
	catalog: ModelsDevCatalog | null,
	models: readonly FetchedProviderModel[],
): FetchedProviderModel[] {
	return models.map((model) => enrichFetchedModel(catalog, model));
}

export function enrichFetchedModel(
	catalog: ModelsDevCatalog | null,
	model: FetchedProviderModel,
): FetchedProviderModel {
	const hit = resolveCatalogLookup(catalog, model.id);
	if (!hit) return model;

	const { entry } = hit;
	const enriched: FetchedProviderModel = { ...model };
	if (!enriched.name && entry.name) enriched.name = entry.name;
	if (enriched.reasoning === undefined && (entry.reasoning || entry.reasoningLevels?.length)) {
		enriched.reasoning = true;
	}
	if (!enriched.reasoningLevels?.length && entry.reasoningLevels?.length) {
		enriched.reasoningLevels = [...entry.reasoningLevels];
	}
	if (enriched.contextWindow === undefined && entry.contextWindow !== undefined) {
		enriched.contextWindow = entry.contextWindow;
	}
	if (enriched.maxTokens === undefined && entry.maxTokens !== undefined) {
		enriched.maxTokens = entry.maxTokens;
	}
	if (enriched.vision === undefined && entry.vision) enriched.vision = true;
	return enriched;
}
