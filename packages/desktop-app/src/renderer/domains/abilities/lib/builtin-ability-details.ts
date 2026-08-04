import type { BuiltinAbilityPresentations } from "@preload/api";
import type { AbilityItem } from "../types";

/** 只有随 App 分发的能力与客户端预置连接器读取内置详情，绝不覆盖市场内容。 */
export function withBuiltinAbilityDetail(item: AbilityItem, presentations: BuiltinAbilityPresentations): AbilityItem {
	if (item.market || (!item.isBuiltin && item.catalogSource.kind !== "builtin")) return item;
	const detail = presentations[`${item.type}:${item.slug}`];
	return detail ? { ...item, detail } : item;
}
