import type { DesignSystem } from "./types";

/**
 * 设计体系展示文案的取值。
 *
 * 内置体系的文案在插件 locales 里（`ds.tagline.<id>` / `ds.category.<key>`）；远端条目
 * 的 id 和分类不可能预先出现在打包好的 catalog 中，所以：标语由条目自带，分类在查不到
 * 译文时回落到原始 key 的可读形式——绝不把 `ds.category.xxx` 这种裸键露给用户。
 */

/** plugin-sdk 的 t() 在查不到译文时原样返回 key，用它判断「没有译文」。 */
function translated(key: string, t: (key: string) => string): string | null {
	const value = t(key);
	return value === key ? null : value;
}

/** `saas-tools` → `Saas tools`，只用于远端引入的、locales 里还没有的分类。 */
function humanize(key: string): string {
	const spaced = key.replaceAll("-", " ").replaceAll("_", " ").trim();
	if (spaced.length === 0) return key;
	return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export function designSystemTagline(
	system: DesignSystem,
	locale: string | undefined,
	t: (key: string) => string,
): string {
	const own = system.tagline;
	if (own) return (locale ?? "").toLowerCase().startsWith("zh") ? own.zh : own.en;
	// 内置体系没有自带译文；catalog 里也查不到时用英文 blurb 兜底，绝不显示裸 key。
	return translated(`ds.tagline.${system.id}`, t) ?? system.blurb;
}

export function designSystemCategoryLabel(system: DesignSystem, t: (key: string) => string): string {
	return translated(`ds.category.${system.category}`, t) ?? humanize(system.category);
}
