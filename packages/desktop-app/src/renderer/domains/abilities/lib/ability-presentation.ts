/**
 * 呈现期常量与解析：图标三态判定、type 的图标 class、详情文案的 locale 覆盖。
 * 模块级常量只存 i18n key / icon class，中文一律在渲染期由 t() 解析。
 */
import type {
	AbilityDetail,
	AbilityDetailBlock,
	AbilityMetaEntry,
	AbilityShowcase,
	AbilityType,
} from "@shared/lib/api";

/** type → 卡片角标图标 class（写在 TS 中便于 UnoCSS 扫描）。 */
export const ABILITY_TYPE_ICON: Record<AbilityType, string> = {
	skill: "icon-[solar--magic-stick-3-linear]",
	scene: "icon-[solar--clapperboard-open-linear]",
	mcp: "icon-[solar--server-square-cloud-linear]",
	plugin: "icon-[solar--plug-circle-linear]",
	bundle: "icon-[solar--box-minimalistic-linear]",
};

/** type → i18n key（abilities ns）。 */
export const ABILITY_TYPE_LABEL_KEY = {
	skill: "type.skill",
	scene: "type.scene",
	mcp: "type.mcp",
	plugin: "type.plugin",
	bundle: "type.bundle",
} as const satisfies Record<AbilityType, string>;

/** 图标取值四态里可以直接当 <img src> 用的那两种。 */
export function isRenderableImageIcon(icon: string | undefined): boolean {
	if (!icon) return false;
	const trimmed = icon.trim();
	if (!trimmed) return false;
	if (trimmed.startsWith("solar:")) return false;
	return trimmed.includes("://") || trimmed.startsWith("/") || trimmed.startsWith("data:");
}

export function isIconifyIcon(icon: string | undefined): boolean {
	return Boolean(icon?.trim().startsWith("solar:"));
}

export interface AbilityDetailContent {
	/** markdown 正文；可能为空。 */
	content: string;
	showcases: AbilityShowcase[];
	/** 宿主白名单渲染的结构化详情区块。 */
	blocks: AbilityDetailBlock[];
	/** 元信息条目，按运营排定的顺序。 */
	meta: AbilityMetaEntry[];
	/** 当前 locale 下的展示名 / 简介；detail 未提供时为 undefined，由调用方回落条目自身字段。 */
	name?: string;
	description?: string;
}

/**
 * `raw.detail` 的 locale 解析：`i18n[locale]` 命中即整体替换该字段，不与默认值合并。
 *
 * 展示字段收进 detail 后，覆盖块与默认值同构，取值统一为 `i18n[locale] ?? 顶层`。
 */
export function resolveAbilityDetailContent(detail: AbilityDetail | undefined, locale: string): AbilityDetailContent {
	const base = detail ?? {};
	const override = base.i18n?.[locale];
	return {
		content: override?.content ?? base.content ?? "",
		showcases: override?.showcases ?? base.showcases ?? [],
		blocks: override?.blocks ?? base.blocks ?? [],
		meta: override?.meta ?? base.meta ?? [],
		name: override?.name ?? base.name,
		description: override?.description ?? base.description,
	};
}
