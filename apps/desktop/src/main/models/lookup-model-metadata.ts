import type { ModelCatalogMeta } from "../../preload/api-types/models.js";
import { getCachedModelsDevCatalog, resolveCatalogLookup } from "./presets/models-dev.js";

/**
 * 按 model id 在 models.dev 目录里查元数据，供设置页「添加模型」一键同步参数。
 *
 * 与「从接口拉取」的补齐共用同一份目录与 id 匹配规则（见 `resolveCatalogLookup`）：
 * 聚合网关带命名空间的 id、裸 id 都能对上。查不到返回 null，由渲染层提示手动填写。
 */
export async function lookupModelMetadata(modelId: string): Promise<ModelCatalogMeta | null> {
	const catalog = await getCachedModelsDevCatalog();
	const hit = resolveCatalogLookup(catalog, modelId);
	if (!hit) return null;
	return {
		provider: hit.provider,
		modelId: hit.modelId,
		...hit.entry,
	};
}
