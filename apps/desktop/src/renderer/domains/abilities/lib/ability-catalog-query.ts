import type { AbilityType } from "@shared/lib/api";
import type { AbilityItem, AbilityProvenanceFilter, AbilityScope } from "../types";
import { isMarketAbilityListed } from "./merge-ability-catalogs";

export interface AbilityCatalogQuery {
	scope: AbilityScope;
	keyword?: string;
	category?: string;
	types?: AbilityItem["type"][];
	sourceIds?: string[];
	/** 来源维度：`market` 只留市场条目，`builtin` 只留随 App 分发的内置能力；缺省不限。 */
	provenance?: AbilityProvenanceFilter;
	page: number;
	pageSize: number;
}

export type AbilityCatalogFilter = Omit<AbilityCatalogQuery, "page" | "pageSize">;

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
	return item.catalogSource.id;
}

/** 是否为通用 Skill（~/.agents/skills 等通用 Agent 技能目录）。 */
export function isUniversalSkill(item: AbilityItem): boolean {
	return item.type === "skill" && Boolean(item.skillSource?.startsWith("agents-"));
}

/** 是否为手动安装/本地创建的能力（本地导入的 skill、本地插件包/npm 插件、手动添加的 MCP 服务）。 */
export function isManuallyInstalledAbility(item: AbilityItem): boolean {
	if (!item.installed || item.isBuiltin) return false;
	if (item.isCustom) return true;
	if (item.type === "plugin") {
		return item.plugin?.source === "archive" || item.plugin?.source === "npm";
	}
	if (item.type === "skill") {
		return (
			(item.skillProvenance?.kind === "native" && item.skillProvenance.scope === "custom") ||
			item.skillSource === "user" ||
			item.skillSource === "project"
		);
	}
	if (item.type === "mcp") {
		return !item.fromMarket && item.origin?.kind !== "github-marketplace" && !item.preset;
	}
	return false;
}

/** 「公开」展示已列入市场的条目以及 Vetta 内置能力。 */
export function isAbilityListedInDiscover(item: AbilityItem): boolean {
	return (item.fromMarket && (!item.market || isMarketAbilityListed(item.market))) || item.isBuiltin;
}

/** 「个人」只展示通用 skill 和手动安装的能力。 */
export function isAbilityListedInPersonal(item: AbilityItem): boolean {
	return isUniversalSkill(item) || isManuallyInstalledAbility(item);
}

/** 按分区、关键词与各筛选维度过滤并排序，不分页。 */
export function filterAbilityCatalog(items: AbilityItem[], filter: AbilityCatalogFilter): AbilityItem[] {
	const keyword = filter.keyword?.trim().toLowerCase() ?? "";
	const types = filter.types?.length ? new Set(filter.types) : null;
	const sourceIds = filter.sourceIds ? new Set(filter.sourceIds) : null;
	const provenance = filter.provenance && filter.provenance !== "all" ? filter.provenance : null;
	const isPublic = filter.scope === "discover" || (filter.scope as string) === "public";
	return items
		.filter((item) => (isPublic ? isAbilityListedInDiscover(item) : isAbilityListedInPersonal(item)))
		.filter((item) => !keyword || item.searchTerms.some((term) => term.toLowerCase().includes(keyword)))
		.filter((item) => !filter.category || item.category === filter.category)
		.filter((item) => !types || types.has(item.type))
		.filter((item) => !sourceIds || sourceIds.has(sourceId(item)))
		.filter((item) => !provenance || (provenance === "builtin") === item.isBuiltin)
		.sort(compareAbilities);
}

/** 按 type 计数，筛选面板用它给每个类型标数量。 */
export function countAbilitiesByType(items: AbilityItem[]): Record<AbilityType, number> {
	const counts: Record<AbilityType, number> = { skill: 0, scene: 0, mcp: 0, plugin: 0, bundle: 0 };
	for (const item of items) counts[item.type] += 1;
	return counts;
}

export function queryAbilityCatalog(items: AbilityItem[], query: AbilityCatalogQuery): AbilityCatalogPage {
	const page = Number.isInteger(query.page) && query.page > 0 ? query.page : 1;
	const pageSize = Number.isInteger(query.pageSize) && query.pageSize > 0 ? query.pageSize : 60;
	const filtered = filterAbilityCatalog(items, query);
	// 内置能力随 App 分发、数量有限，整组返回不参与分页：它们 downloadCount 为 0 会排在最后，
	// 若按扁平列表切片，「Vetta 内置」分组只会出现零星几条，分组计数也跟着显示成已加载数。
	const builtin = filtered.filter((item) => item.isBuiltin);
	const paged = filtered.filter((item) => !item.isBuiltin);
	const total = filtered.length;
	return {
		items: [...paged.slice((page - 1) * pageSize, page * pageSize), ...builtin],
		total,
		page,
		pageSize,
		pageCount: Math.ceil(paged.length / pageSize),
	};
}
