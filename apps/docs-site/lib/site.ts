export const DEFAULT_DOCS_SITE_URL = "https://docs.openvetta.com";

export const site = {
	name: "Vetta",
	title: "Vetta 文档",
	description:
		"Vetta 把模型、本地文件和本机工具放进同一个桌面 Agent 工作台。本站从首次任务讲到权限、批量、自动化、插件、主题与 SDK。",
	locale: "zh-CN",
	openGraphLocale: "zh_CN",
	marketingUrl: "https://www.openvetta.com",
	downloadUrl: "https://www.openvetta.com/download",
	githubUrl: "https://github.com/openvetta/open-vetta",
	logoPath: "/images/vetta-app-icon.webp",
	ogImagePath: "/opengraph-image/",
	applicationCategory: "DeveloperApplication",
	operatingSystem: "Windows, macOS, Linux",
} as const;

export const sectionLabels: Record<string, string> = {
	"getting-started": "01 / 开始使用",
	core: "02 / 核心工作流",
	product: "03 / 使用指南",
	plugins: "04 / 插件开发",
	themes: "05 / 主题开发",
	developers: "06 / 开发者",
	reference: "07 / 参考",
	troubleshooting: "08 / 支持",
};

export const sectionTitles: Record<string, string> = {
	"getting-started": "开始使用",
	core: "核心工作流",
	product: "使用指南",
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
	plugins: "/plugins/overview/",
	themes: "/themes/overview/",
	developers: "/developers/overview/",
	reference: "/reference/security-and-data/",
	troubleshooting: "/troubleshooting/",
};

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
