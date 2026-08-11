/**
 * Knowledge 标签的交、并、补集合运算。
 *
 * all  = 交：页必须同时包含全部这些标签
 * any  = 并：页必须至少包含其中一个标签
 * none = 补：页必须不包含任何这些标签（相对全库）
 *
 * 三个子句以 AND 组合；缺省/空子句不施加约束。
 */

export interface TagQuery {
	all?: string[];
	any?: string[];
	none?: string[];
}

export interface TaggedPage {
	id: string;
	tags: string[];
}

const hasAll = (tagSet: Set<string>, required: string[]): boolean => required.every((t) => tagSet.has(t));

const hasAny = (tagSet: Set<string>, candidates: string[]): boolean => candidates.some((t) => tagSet.has(t));

const hasNone = (tagSet: Set<string>, excluded: string[]): boolean => !excluded.some((t) => tagSet.has(t));

/** 按标签查询过滤页面，返回命中的页 id（保持输入顺序）。 */
export function filterByTags(pages: TaggedPage[], query: TagQuery): string[] {
	const all = query.all ?? [];
	const any = query.any ?? [];
	const none = query.none ?? [];

	const result: string[] = [];
	for (const page of pages) {
		const tagSet = new Set(page.tags);
		if (all.length > 0 && !hasAll(tagSet, all)) continue;
		if (any.length > 0 && !hasAny(tagSet, any)) continue;
		if (none.length > 0 && !hasNone(tagSet, none)) continue;
		result.push(page.id);
	}
	return result;
}
