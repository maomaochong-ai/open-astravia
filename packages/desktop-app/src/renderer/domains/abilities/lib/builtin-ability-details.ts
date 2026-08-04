import type { BuiltinAbilityPresentations } from "@preload/api";
import type { AbilityItem } from "../types";

/** 已安装能力优先读取包内详情；未安装条目继续使用市场详情。 */
export function withBuiltinAbilityDetail(item: AbilityItem, presentations: BuiltinAbilityPresentations): AbilityItem {
	const readsPackageDetail =
		item.type === "plugin" ? item.installed : item.isBuiltin || item.catalogSource.kind === "builtin";
	if (!readsPackageDetail) return item;
	const detail = presentations[`${item.type}:${item.slug}`];
	return detail ? { ...item, detail } : item;
}
