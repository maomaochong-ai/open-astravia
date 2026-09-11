import type { LocalAbilityPresentations } from "@preload/api";
import type { AbilityItem } from "../types";

/**
 * 已安装或内置资源优先使用本地包的呈现；未安装市场条目继续使用目录数据。
 * 图标与详情在同一处叠加，避免两者经过不同的数据链路。
 */
export function withLocalAbilityPresentation(item: AbilityItem, presentations: LocalAbilityPresentations): AbilityItem {
	if (!item.installed && !item.isBuiltin && item.catalogSource.kind !== "builtin") return item;
	const presentation = presentations[`${item.type}:${item.slug}`];
	if (!presentation) return item;
	return {
		...item,
		...(presentation.icon ? { icon: presentation.icon } : {}),
		...(presentation.detail ? { detail: presentation.detail } : {}),
	};
}
