import type { FetchedProviderModel } from "@preload/api.js";

/**
 * 「从接口拉取」抽屉里的列表逻辑：搜索过滤与勾选集合运算。
 *
 * 全选/全不选只作用于**当前筛选可见**的模型：搜索后用户看到的是一批候选，
 * 全集里被筛掉的勾选状态应当原样保留，否则搜索会静默清空之前的选择。
 */

/** 搜索用的归一化：去掉首尾空白、全角转半角、忽略大小写。 */
export function normalizeFetchedModelQuery(query: string): string {
	return query.trim().normalize("NFKC").toLocaleLowerCase();
}

export function filterFetchedModels(models: readonly FetchedProviderModel[], query: string): FetchedProviderModel[] {
	const normalized = normalizeFetchedModelQuery(query);
	if (!normalized) return [...models];
	return models.filter((model) =>
		`${model.name ?? ""}\n${model.id}`.normalize("NFKC").toLocaleLowerCase().includes(normalized),
	);
}

export function toggleModelSelection(selected: readonly string[], id: string): string[] {
	return selected.includes(id) ? selected.filter((item) => item !== id) : [...selected, id];
}

/** 并集：把仍可见的那批模型并入选择，不动已选但被筛掉的项。 */
export function selectModels(selected: readonly string[], ids: readonly string[]): string[] {
	const next = new Set(selected);
	for (const id of ids) next.add(id);
	return [...next];
}

/** 差集：只移除传入的可见项，保留被筛掉但已勾选的项。 */
export function deselectModels(selected: readonly string[], ids: readonly string[]): string[] {
	const removed = new Set(ids);
	return selected.filter((id) => !removed.has(id));
}
