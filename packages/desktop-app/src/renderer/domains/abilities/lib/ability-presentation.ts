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
	MarketAbility,
} from "../market-types";

/** type → 卡片角标图标 class（写在 TS 中便于 UnoCSS 扫描）。 */
export const ABILITY_TYPE_ICON: Record<AbilityType, string> = {
	skill: "icon-[solar--magic-stick-3-linear]",
	mcp: "icon-[solar--server-square-cloud-linear]",
	plugin: "icon-[solar--plug-circle-linear]",
	bundle: "icon-[solar--box-minimalistic-linear]",
};

/** type → i18n key（abilities ns）。 */
export const ABILITY_TYPE_LABEL_KEY = {
	skill: "type.skill",
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
	// `./mcp/xxx.png`：内置 MCP 预设图标是相对路径（打包后走 file://，vite base 为 "./"）
	return trimmed.includes("://") || trimmed.startsWith("/") || trimmed.startsWith("./") || trimmed.startsWith("data:");
}

export function isIconifyIcon(icon: string | undefined): boolean {
	return Boolean(icon?.trim().startsWith("solar:"));
}

function baseLanguage(locale: string): string {
	return locale.trim().toLowerCase().split(/[-_]/)[0] ?? "";
}

/**
 * 取译文块：精确匹配 → 基语言键 → 同基语言的任一地区键。
 *
 * 服务端写入的 locale 键口径并不统一：插件包 `locales/*.json` 解析出的是 `zh` / `en`，
 * 而 admin 手填与分类译名走的是 `zh-CN` / `en-US`（`SupportedLocales`）。界面语言只有
 * `zh` / `en`，若在此精确匹配，admin 录入的译文会永远命中不到、全量回落默认语言。
 * 归一放在读侧而非写侧：存量数据不必迁移，两条写入路径都能生效。
 */
export function pickLocaleValue<T>(map: Record<string, T> | undefined, locale: string): T | undefined {
	if (!map) return undefined;
	const exact = map[locale];
	if (exact !== undefined) return exact;
	const base = baseLanguage(locale);
	if (!base) return undefined;
	// 键顺序在 JSON 反序列化后不保证，排序后再取首个命中，避免同基语言多地区键时结果抖动
	const keys = Object.keys(map).sort();
	const baseKey = keys.find((key) => key.trim().toLowerCase() === base);
	if (baseKey !== undefined) return map[baseKey];
	const regionKey = keys.find((key) => baseLanguage(key) === base);
	return regionKey === undefined ? undefined : map[regionKey];
}

/**
 * 分类兜底字典：服务端 catalog 未提供 `category_i18n[locale]` 时的客户端翻译。
 * 键是服务端 `AbilityCategory.Name`（分组 key），值是各语言展示名。
 * 补这个表的原因：线上能力目录的分类由运营/服务端录入，偶尔只给了英文名。
 * 客户端兜底后，用户界面语言 = zh 时不会再看到混杂英文的分类标题。
 */
const CATEGORY_FALLBACK_I18N: Record<string, Record<string, string>> = {
	Development: { zh: "开发", en: "Development" },
	Documents: { zh: "文档", en: "Documents" },
	Design: { zh: "设计", en: "Design" },
	Productivity: { zh: "效率工具", en: "Productivity" },
	Marketing: { zh: "市场营销", en: "Marketing" },
	Research: { zh: "研究", en: "Research" },
	Education: { zh: "教育", en: "Education" },
	Writing: { zh: "写作", en: "Writing" },
	Workflow: { zh: "工作流", en: "Workflow" },
	Data: { zh: "数据", en: "Data" },
	Database: { zh: "数据库", en: "Database" },
	Finance: { zh: "财务", en: "Finance" },
	HR: { zh: "人力资源", en: "HR" },
	Legal: { zh: "法务", en: "Legal" },
	Sales: { zh: "销售", en: "Sales" },
	Customer: { zh: "客户服务", en: "Customer" },
	Analytics: { zh: "分析", en: "Analytics" },
	Communication: { zh: "沟通", en: "Communication" },
	Media: { zh: "媒体", en: "Media" },
	Image: { zh: "图像", en: "Image" },
	Video: { zh: "视频", en: "Video" },
	Audio: { zh: "音频", en: "Audio" },
	Translation: { zh: "翻译", en: "Translation" },
	Code: { zh: "代码", en: "Code" },
	DevOps: { zh: "运维", en: "DevOps" },
	Security: { zh: "安全", en: "Security" },
	Testing: { zh: "测试", en: "Testing" },
	Infrastructure: { zh: "基础设施", en: "Infrastructure" },
	AI: { zh: "AI", en: "AI" },
	Automation: { zh: "自动化", en: "Automation" },
	Other: { zh: "其他", en: "Other" },
};

/**
 * 分类展示名：服务端 `i18n[locale]` → 客户端兜底字典 → 原规范名。
 * 与 `raw.detail` 的取值口径一致；兜底字典让服务端缺翻译时界面语言仍保持一致。
 *
 * 规范名（服务端 `AbilityCategory.Name`）同时是分组与筛选的 key，不参与翻译；
 * 界面上看到的永远是这里解析出来的展示名。
 */
export function resolveCategoryLabel(
	category: string,
	i18n: Record<string, string> | undefined,
	locale: string,
): string {
	const serverLabel = pickLocaleValue(i18n, locale)?.trim();
	if (serverLabel) return serverLabel;
	const fallback = CATEGORY_FALLBACK_I18N[category];
	if (fallback) {
		const fallbackLabel = pickLocaleValue(fallback, locale)?.trim();
		if (fallbackLabel) return fallbackLabel;
	}
	return category;
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
	const override = pickLocaleValue(base.i18n, locale);
	return {
		content: override?.content ?? base.content ?? "",
		showcases: override?.showcases ?? base.showcases ?? [],
		blocks: override?.blocks ?? base.blocks ?? [],
		meta: override?.meta ?? base.meta ?? [],
		name: override?.name ?? base.name,
		description: override?.description ?? base.description,
	};
}

/**
 * 市场行的 locale 归一：把 `detail.i18n[locale]` 的 name / description / tags 提到顶层。
 *
 * 顶层字段是服务端从 `raw.detail` 投影出的**默认语言**，条目组装（build-ability-items）
 * 与搜索词都只读顶层；不在这里先归一，卡片标题、简介、标签与搜索就永远停在默认语言，
 * 只有详情页正文跟随界面语言——即「设了双语却只显示第一种」。
 *
 * 放在组装入口而非渲染期，是为了让 `searchTerms` 与分组一并跟随语言，且四种 type 的
 * 组装函数保持纯函数、签名不变。
 */
export function localizeMarketAbility(entry: MarketAbility, locale: string): MarketAbility {
	const override = pickLocaleValue(entry.detail?.i18n, locale);
	if (!override) return entry;
	const name = override.name?.trim();
	const description = override.description?.trim();
	// tags 是整体替换：译文块给了就用它，空数组视为未覆盖
	const tags = override.tags?.length ? override.tags : undefined;
	if (!name && !description && !tags) return entry;
	return {
		...entry,
		name: name || entry.name,
		description: description || entry.description,
		tags: tags ?? entry.tags,
	};
}
