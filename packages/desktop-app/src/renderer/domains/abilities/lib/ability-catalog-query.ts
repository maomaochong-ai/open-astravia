import type { AbilityItem, AbilityScope } from "../types";

export interface AbilityCatalogQuery {
	scope: AbilityScope;
	keyword?: string;
	category?: string;
	types?: AbilityItem["type"][];
	sourceIds?: string[];
	page: number;
	pageSize: number;
}

export interface AbilityCatalogPage {
	items: AbilityItem[];
	total: number;
	page: number;
	pageSize: number;
	pageCount: number;
}

/** 只使用不会随安装操作变化的字段排序，避免卡片在操作后跳位。 */
export function compareAbilities(a: AbilityItem, b: AbilityItem): number {
	if (a.downloadCount !== b.downloadCount) return b.downloadCount - a.downloadCount;
	const titleOrder = a.title.localeCompare(b.title);
	return titleOrder || a.id.localeCompare(b.id);
}

function sourceId(item: AbilityItem): string {
	if (item.origin?.kind === "github-marketplace") return item.origin.sourceId ?? item.origin.repository;
	if (item.fromMarket) return "server";
	if (item.isBuiltin) return "builtin";
	return "local";
}

export function queryAbilityCatalog(items: AbilityItem[], query: AbilityCatalogQuery): AbilityCatalogPage {
	const keyword = query.keyword?.trim().toLowerCase() ?? "";
	const types = query.types ? new Set(query.types) : null;
	const sourceIds = query.sourceIds ? new Set(query.sourceIds) : null;
	const page = Number.isInteger(query.page) && query.page > 0 ? query.page : 1;
	const pageSize = Number.isInteger(query.pageSize) && query.pageSize > 0 ? query.pageSize : 60;
	const filtered = items
		.filter((item) => (query.scope === "discover" ? item.fromMarket : item.installed))
		.filter((item) => !keyword || item.searchTerms.some((term) => term.toLowerCase().includes(keyword)))
		.filter((item) => !query.category || item.category === query.category)
		.filter((item) => !types || types.has(item.type))
		.filter((item) => !sourceIds || sourceIds.has(sourceId(item)))
		.sort(compareAbilities);
	const total = filtered.length;
	return {
		items: filtered.slice((page - 1) * pageSize, page * pageSize),
		total,
		page,
		pageSize,
		pageCount: Math.ceil(total / pageSize),
	};
}
