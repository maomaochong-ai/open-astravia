import { defineI18n } from "fumadocs-core/i18n";
import type { I18nProviderProps } from "fumadocs-ui/contexts/i18n";
import { i18nProvider, uiTranslations as fumadocsUiTranslations } from "fumadocs-ui/i18n";

/**
 * The locale registry is the only place where supported documentation
 * languages are declared. Add a locale here only after its content and
 * messages have been added to the completeness checks.
 */
export const docsI18n = defineI18n({
	languages: ["zh", "en"],
	defaultLanguage: "zh",
	hideLocale: "always",
	parser: "dir",
	// Every registered language must ship a complete content tree. Missing
	// translations should fail visibly instead of mixing languages at runtime.
	fallbackLanguage: null,
});

export type DocsLanguage = (typeof docsI18n.languages)[number];

export interface LocaleConfig {
	displayName: string;
	htmlLang: string;
	intlLocale: string;
	openGraphLocale: string;
	articleTitleFormat: "plain" | "qualified";
}

export const localeConfig = {
	zh: {
		displayName: "中文",
		htmlLang: "zh-CN",
		intlLocale: "zh-CN",
		openGraphLocale: "zh_CN",
		articleTitleFormat: "plain",
	},
	en: {
		displayName: "English",
		htmlLang: "en-US",
		intlLocale: "en-US",
		openGraphLocale: "en_US",
		articleTitleFormat: "qualified",
	},
} satisfies Record<DocsLanguage, LocaleConfig>;

export const languageNames: Record<DocsLanguage, string> = Object.fromEntries(
	docsI18n.languages.map((language) => [language, localeConfig[language].displayName]),
) as Record<DocsLanguage, string>;

export interface DocsMessages {
	documentation: string;
	startWithOneTask: string;
	workspaceDescriptor: string;
	updatedOn: string;
	openThisPage: string;
	open: string;
	takeawaysAria: string;
	takeawaysKicker: string;
	signal: string;
	healthy: string;
	needsAttention: string;
	regularChat: string;
	nextSteps: string;
	continueKicker: string;
	viewMarkdown: string;
	downloadApp: string;
	website: string;
	homeProofAria: string;
	optional: string;
	websiteDescription: string;
	downloadDescription: string;
	githubDescription: string;
	markdownDescription: string;
}

/** Application-owned copy. Fumadocs-owned copy is registered below. */
export const messages = {
	zh: {
		documentation: "文档",
		startWithOneTask: "从一次任务开始",
		workspaceDescriptor: "本地工作区 · 可检查 · 可复用",
		updatedOn: "更新于",
		openThisPage: "打开本页",
		open: "OPEN / 打开",
		takeawaysAria: "读完带走",
		takeawaysKicker: "READ / 带走",
		signal: "信号",
		healthy: "正常",
		needsAttention: "需要介入",
		regularChat: "普通对话",
		nextSteps: "下一页",
		continueKicker: "NEXT / 下一页",
		viewMarkdown: "查看 Markdown",
		downloadApp: "下载客户端",
		website: "官网",
		homeProofAria: "Vetta 核心特征",
		optional: "可选入口",
		websiteDescription: "产品介绍与下载",
		downloadDescription: "Windows / macOS / Linux 安装包",
		githubDescription: "开源仓库",
		markdownDescription: "任意文档页可追加 `.md` 获取纯 Markdown，例如 `/product/models.md`",
	},
	en: {
		documentation: "Documentation",
		startWithOneTask: "Start with one task",
		workspaceDescriptor: "Local workspace · Inspectable · Reusable",
		updatedOn: "Updated on",
		openThisPage: "Open this page",
		open: "OPEN",
		takeawaysAria: "Key takeaways",
		takeawaysKicker: "READ / TAKEAWAYS",
		signal: "Signal",
		healthy: "Healthy",
		needsAttention: "Needs attention",
		regularChat: "Regular chat",
		nextSteps: "Next steps",
		continueKicker: "NEXT / CONTINUE",
		viewMarkdown: "View Markdown",
		downloadApp: "Download app",
		website: "Website",
		homeProofAria: "Vetta core benefits",
		optional: "Optional",
		websiteDescription: "Product information and downloads",
		downloadDescription: "Windows / macOS / Linux installers",
		githubDescription: "Open-source repository",
		markdownDescription: "Append `.md` to any docs page to get Markdown, for example `/product/models.md`",
	},
} satisfies Record<DocsLanguage, DocsMessages>;

const fumadocsTranslations = docsI18n
	.translations()
	.extend(fumadocsUiTranslations())
	.add({
		zh: {
			displayName: localeConfig.zh.displayName,
			"Search(search dialog)": "搜索文档",
			"Search(search trigger)": "搜索",
			"No results found(search dialog)": "没有找到结果",
			"On this page(table of contents)": "本页内容",
			"Next Page(pagination)": "下一页",
			"Previous Page(pagination)": "上一页",
			"Open Search(search trigger)(aria-label)": "打开搜索",
			"Open Sidebar(sidebar)(aria-label)": "打开侧栏",
			"Close Sidebar(sidebar)(aria-label)": "关闭侧栏",
			"Toggle Menu(mobile menu)(aria-label)": "切换菜单",
			"Toggle Theme(theme switcher)(aria-label)": "切换主题",
			"Light(theme switcher)(aria-label)": "浅色",
			"Dark(theme switcher)(aria-label)": "深色",
			"System(theme switcher)(aria-label)": "跟随系统",
			"Last updated on(page footer)": "更新于",
			"Copy Markdown(page actions)": "复制 Markdown",
			"View as Markdown(page actions)": "查看 Markdown",
			"Open(page actions)": "打开",
			"Open in ChatGPT(page actions)": "在 ChatGPT 中打开",
			"Open in Claude(page actions)": "在 Claude 中打开",
			"No Headings(table of contents)": "本页没有标题",
			"Hide Sidebar(sidebar)": "隐藏侧栏",
			"Show Sidebar(sidebar)": "显示侧栏",
			"Collapse Sidebar(sidebar)(aria-label)": "折叠侧栏",
		},
		en: {
			displayName: localeConfig.en.displayName,
			"Search(search dialog)": "Search docs",
			"Search(search trigger)": "Search",
			"No results found(search dialog)": "No results found",
			"On this page(table of contents)": "On this page",
			"Next Page(pagination)": "Next page",
			"Previous Page(pagination)": "Previous page",
			"Open Search(search trigger)(aria-label)": "Open search",
			"Open Sidebar(sidebar)(aria-label)": "Open sidebar",
			"Close Sidebar(sidebar)(aria-label)": "Close sidebar",
			"Toggle Menu(mobile menu)(aria-label)": "Toggle menu",
			"Toggle Theme(theme switcher)(aria-label)": "Toggle theme",
			"Light(theme switcher)(aria-label)": "Light",
			"Dark(theme switcher)(aria-label)": "Dark",
			"System(theme switcher)(aria-label)": "System",
			"Last updated on(page footer)": "Updated on",
			"Copy Markdown(page actions)": "Copy Markdown",
			"View as Markdown(page actions)": "View as Markdown",
			"Open(page actions)": "Open",
			"Open in ChatGPT(page actions)": "Open in ChatGPT",
			"Open in Claude(page actions)": "Open in Claude",
			"No Headings(table of contents)": "No headings",
			"Hide Sidebar(sidebar)": "Hide sidebar",
			"Show Sidebar(sidebar)": "Show sidebar",
			"Collapse Sidebar(sidebar)(aria-label)": "Collapse sidebar",
		},
	});

export function isDocsLanguage(value: string): value is DocsLanguage {
	return docsI18n.languages.includes(value as DocsLanguage);
}

export function getI18nProvider(language: DocsLanguage): I18nProviderProps {
	return i18nProvider(fumadocsTranslations, language);
}

export function getDocsMessages(language: DocsLanguage): DocsMessages {
	return messages[language];
}

function decodeCookieValue(value: string): string | undefined {
	try {
		return decodeURIComponent(value);
	} catch {
		return undefined;
	}
}

function languagePreferences(header: string): string[] {
	return header
		.split(",")
		.map((part, index) => {
			const [rawLanguage, ...parameters] = part.trim().split(";");
			const quality = Number(parameters.find((parameter) => parameter.trim().startsWith("q="))?.trim().slice(2) ?? "1");
			return { language: rawLanguage?.toLowerCase(), quality: Number.isFinite(quality) ? quality : 0, index };
		})
		.filter((item): item is { language: string; quality: number; index: number } => Boolean(item.language) && item.quality > 0)
		.sort((left, right) => right.quality - left.quality || left.index - right.index)
		.map((item) => item.language);
}

function matchLanguage(preference: string): DocsLanguage | undefined {
	if (preference === "*") return docsI18n.defaultLanguage;

	const exact = docsI18n.languages.find((language) => language.toLowerCase() === preference);
	if (exact) return exact;

	const base = preference.split("-")[0];
	return docsI18n.languages.find((language) => language.split("-")[0].toLowerCase() === base);
}

export function getRequestLanguage(request: Request): DocsLanguage {
	const cookie = request.headers.get("cookie")?.match(/(?:^|;\s*)FD_LOCALE=([^;]+)/u)?.[1];
	const savedLanguage = cookie ? decodeCookieValue(cookie) : undefined;
	if (savedLanguage && isDocsLanguage(savedLanguage)) return savedLanguage;

	for (const preference of languagePreferences(request.headers.get("accept-language") ?? "")) {
		const language = matchLanguage(preference);
		if (language) return language;
	}

	return docsI18n.defaultLanguage;
}
