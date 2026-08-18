import { useCallback } from "react";
import { usePluginI18n } from "../../plugins/runtime/plugin-i18n";
import type { AbilityItem } from "../types";

/**
 * 插件的 name / description 可能是 `%catalogKey%` 占位符（ADR-0033），需要用插件自带
 * catalog 解析；其余 type 直接透传。条目组装是纯函数，故解析放在渲染期。
 */
export function useAbilityText(): (item: AbilityItem) => { title: string; description: string } {
	const tr = usePluginI18n();
	return useCallback(
		(item) => {
			if (item.type === "plugin" && item.plugin) {
				return { title: tr(item.plugin, item.title), description: tr(item.plugin, item.description) };
			}
			return { title: item.title, description: item.description };
		},
		[tr],
	);
}
