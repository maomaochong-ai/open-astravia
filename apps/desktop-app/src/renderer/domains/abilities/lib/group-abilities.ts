/**
 * 列表分组：按分类聚合，另把随 App 分发的内置能力单独成组。
 *
 * 顺序固定为「连接 → 各分类 → Vetta 内置 → 未分类」：市场安装的能力都带分类，
 * `~/.agents/skills` 等本地能力无分类落在最后，内置能力夹在两者之间。
 */
import {
	ABILITY_CATEGORY_CONNECTORS,
	ABILITY_CATEGORY_UNCATEGORIZED,
	ABILITY_CATEGORY_VETTA_BUILTIN,
	type AbilityGroup,
	type AbilityItem,
} from "../types";

export function groupAbilities(items: AbilityItem[]): AbilityGroup[] {
	const byCategory = new Map<string, AbilityItem[]>();
	// 译名按分类只需一份；同分类的条目带的是同一个块，取先到的即可。
	const i18nByCategory = new Map<string, Record<string, string>>();
	for (const item of items) {
		const key = item.isBuiltin ? ABILITY_CATEGORY_VETTA_BUILTIN : item.category || ABILITY_CATEGORY_UNCATEGORIZED;
		const bucket = byCategory.get(key);
		if (bucket) bucket.push(item);
		else byCategory.set(key, [item]);
		if (item.categoryI18n && !i18nByCategory.has(key)) i18nByCategory.set(key, item.categoryI18n);
	}
	// 三个合成分组固定位置，其余按规范名排序：分组顺序不随界面语言跳动
	const connectors = byCategory.get(ABILITY_CATEGORY_CONNECTORS);
	byCategory.delete(ABILITY_CATEGORY_CONNECTORS);
	const builtin = byCategory.get(ABILITY_CATEGORY_VETTA_BUILTIN);
	byCategory.delete(ABILITY_CATEGORY_VETTA_BUILTIN);
	const uncategorized = byCategory.get(ABILITY_CATEGORY_UNCATEGORIZED);
	byCategory.delete(ABILITY_CATEGORY_UNCATEGORIZED);
	const sorted = Array.from(byCategory.entries())
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([category, list]) => ({ category, categoryI18n: i18nByCategory.get(category), items: list }));
	return [
		...(connectors ? [{ category: ABILITY_CATEGORY_CONNECTORS, items: connectors }] : []),
		...sorted,
		...(builtin ? [{ category: ABILITY_CATEGORY_VETTA_BUILTIN, items: builtin }] : []),
		...(uncategorized ? [{ category: ABILITY_CATEGORY_UNCATEGORIZED, items: uncategorized }] : []),
	];
}
