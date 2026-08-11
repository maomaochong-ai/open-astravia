import type { PluginNavBadge } from "@vetta-org/plugin-sdk";
import type { SidebarNavBadge } from "./types";

/**
 * 插件角标 → 主题层角标。
 *
 * 两件事在这里做完，视图层因此完全不需要认识插件：
 * - `beta` 换成宿主自己的 Beta 文案（与内置知识库同一个 i18n key）——插件声明
 *   一个 kind 就能拿到与内置项一模一样的标识，不必自己把 "Beta" 翻译一遍。
 * - `text` 走插件目录解析 `%catalogKey%`，与 label 同一套机制。
 *
 * 解析后为空的 text 返回 undefined：`%missing.key%` 解析不出来时挂一个空胶囊
 * 比没有角标更糟。
 */
export function toSidebarNavBadge(
	badge: PluginNavBadge | undefined,
	resolveText: (raw: string) => string,
	betaLabel: string,
): SidebarNavBadge | undefined {
	if (!badge) return undefined;
	if (badge.kind === "beta") {
		const text = betaLabel.trim();
		return text ? { kind: "text", text } : undefined;
	}
	if (badge.kind === "text") {
		const text = resolveText(badge.text).trim();
		return text ? { kind: "text", text, ...(badge.tone ? { tone: badge.tone } : {}) } : undefined;
	}
	return badge;
}
