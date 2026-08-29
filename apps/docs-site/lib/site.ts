import { getDocsMessages, localeConfig, type DocsLanguage } from "./i18n";

export const DEFAULT_DOCS_SITE_URL = "https://docs.openvetta.com";

export const site = {
	name: "Vetta",
	title: "Vetta 文档",
	description:
		"Vetta 把模型、本地文件和本机工具放进同一个桌面 Agent 工作台。本站提供快速开始、实战示例，以及权限、批量、自动化、插件、主题与 SDK 指南。",
	locale: localeConfig.zh.intlLocale,
	openGraphLocale: localeConfig.zh.openGraphLocale,
	marketingUrl: "https://www.openvetta.com",
	downloadUrl: "https://www.openvetta.com/download",
	githubUrl: "https://github.com/openvetta/open-vetta",
	logoPath: "/images/vetta-app-icon.webp",
	ogImagePath: "/opengraph-image/",
	applicationCategory: "DeveloperApplication",
	operatingSystem: "Windows, macOS, Linux",
} as const;

export const localizedSite = {
	zh: {
		title: "Vetta 文档",
		description:
			"Vetta 把模型、本地文件和本机工具放进同一个桌面 Agent 工作台。本站提供快速开始、实战示例，以及权限、批量、自动化、插件、主题与 SDK 指南。",
		openGraphLocale: localeConfig.zh.openGraphLocale,
		locale: localeConfig.zh.intlLocale,
	},
	en: {
		title: "Vetta Documentation",
		description:
			"Vetta brings models, local files, and machine tools into one desktop Agent workspace. Learn how to get started, build workflows, configure permissions, extend Vetta, and use the SDK.",
		openGraphLocale: localeConfig.en.openGraphLocale,
		locale: localeConfig.en.intlLocale,
	},
} satisfies Record<DocsLanguage, { title: string; description: string; openGraphLocale: string; locale: string }>;

export type SiteLanguage = DocsLanguage;

export const sectionLabels: Record<string, string> = {
	"getting-started": "01 / 开始使用",
	core: "02 / 核心工作流",
	product: "03 / 使用指南",
	examples: "04 / 实战示例",
	plugins: "05 / 插件开发",
	themes: "06 / 主题开发",
	developers: "07 / 开发者",
	reference: "08 / 参考",
	troubleshooting: "09 / 支持",
};

export const sectionTitles: Record<string, string> = {
	"getting-started": "开始使用",
	core: "核心工作流",
	product: "使用指南",
	examples: "实战示例",
	plugins: "插件开发",
	themes: "主题开发",
	developers: "开发者",
	reference: "参考",
	troubleshooting: "支持",
};

export const sectionLandingPaths: Record<string, string> = {
	"getting-started": "/getting-started/",
	core: "/core/overview/",
	product: "/product/overview/",
	examples: "/examples/",
	plugins: "/plugins/overview/",
	themes: "/themes/overview/",
	developers: "/developers/overview/",
	reference: "/reference/security-and-data/",
	troubleshooting: "/troubleshooting/",
};

const localizedSections: Record<SiteLanguage, {
	labels: Record<string, string>;
	titles: Record<string, string>;
}> = {
	zh: { labels: sectionLabels, titles: sectionTitles },
	en: {
		labels: {
			"getting-started": "01 / GETTING STARTED",
			core: "02 / CORE WORKFLOWS",
			product: "03 / USER GUIDE",
			examples: "04 / EXAMPLES",
			plugins: "05 / PLUGIN DEVELOPMENT",
			themes: "06 / THEME DEVELOPMENT",
			developers: "07 / DEVELOPERS",
			reference: "08 / REFERENCE",
			troubleshooting: "09 / SUPPORT",
		},
		titles: {
			"getting-started": "Getting started",
			core: "Core workflows",
			product: "User guide",
			examples: "Examples",
			plugins: "Plugin development",
			themes: "Theme development",
			developers: "Developers",
			reference: "Reference",
			troubleshooting: "Support",
		},
	},
};

export function getLocalizedSite(language: SiteLanguage = "zh") {
	return localizedSite[language];
}

export function getSectionLabel(section: string | undefined, language: SiteLanguage = "zh"): string {
	return localizedSections[language].labels[section ?? ""] ?? `VETTA / ${getDocsMessages(language).documentation}`;
}

export function getSectionTitle(section: string | undefined, language: SiteLanguage = "zh"): string {
	return localizedSections[language].titles[section ?? ""] ?? section ?? getDocsMessages(language).documentation;
}

export function getSectionLandingPath(section: string | undefined): string {
	return sectionLandingPaths[section ?? ""] ?? `/${section ?? ""}/`;
}

export function getSiteOrigin(envUrl = process.env.DOCS_SITE_URL): string {
	const raw = envUrl?.trim() || DEFAULT_DOCS_SITE_URL;
	return raw.replace(/\/+$/, "");
}

export function toCanonicalPath(path: string): string {
	if (!path || path === "/") return "/";
	const withLeadingSlash = path.startsWith("/") ? path : `/${path}`;
	if (/\.[a-z0-9]+$/i.test(withLeadingSlash)) return withLeadingSlash;
	return withLeadingSlash.endsWith("/") ? withLeadingSlash : `${withLeadingSlash}/`;
}

export function toAbsoluteUrl(path: string, origin = getSiteOrigin()): string {
	return new URL(toCanonicalPath(path), `${origin}/`).href;
}

export function toMarkdownPath(path: string): string {
	const canonical = toCanonicalPath(path);
	if (canonical === "/") return "/index.md";
	return `${canonical.replace(/\/$/, "")}.md`;
}
