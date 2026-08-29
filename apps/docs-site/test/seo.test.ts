import { describe, expect, it } from "vitest";
import { buildPageMetadata, buildRootMetadata } from "../lib/seo/metadata";
import { buildRobotsConfig } from "../lib/seo/robots";
import {
	breadcrumbItemsFromSlugs,
	buildPageJsonLd,
	collectSchemaTypes,
	hasDeprecatedSchemaType,
} from "../lib/seo/schema";
import { buildSitemapEntries } from "../lib/seo/sitemap";
import {
	DEFAULT_DOCS_SITE_URL,
	getSiteOrigin,
	site,
	toAbsoluteUrl,
	toCanonicalPath,
	toMarkdownPath,
} from "../lib/site";

const origin = "https://docs.example.test";

describe("site URL helpers", () => {
	it("normalizes trailing slashes and markdown alternates", () => {
		expect(toCanonicalPath("product/models")).toBe("/product/models/");
		expect(toCanonicalPath("/product/models/")).toBe("/product/models/");
		expect(toMarkdownPath("/product/models/")).toBe("/product/models.md");
		expect(toAbsoluteUrl("/getting-started/", origin)).toBe(`${origin}/getting-started/`);
	});

	it("prefers DOCS_SITE_URL without a trailing slash", () => {
		expect(getSiteOrigin("https://docs.openvetta.com/")).toBe(DEFAULT_DOCS_SITE_URL);
	});
});

describe("metadata", () => {
	it("uses a title template at the site root and does not suffix the homepage", () => {
		const root = buildRootMetadata(origin);
		expect(root.title).toEqual({
			default: site.title,
			template: `%s | ${site.title}`,
		});

		const home = buildPageMetadata({
			title: "Vetta 文档",
			description: site.description,
			path: "/",
			isHome: true,
		});
		expect(home.title).toEqual({ absolute: site.title });
		expect(home.alternates).toEqual({ canonical: "/", types: undefined });
		expect(home.openGraph).toMatchObject({ type: "website" });
	});

	it("emits unique article metadata, canonical, and markdown alternate", () => {
		const metadata = buildPageMetadata({
			title: "配置模型",
			description: "在设置中添加预设或自定义服务商。",
			path: "/product/models",
			isHome: false,
		});

		expect(metadata.title).toBe("配置模型");
		expect(metadata.description).toBe("在设置中添加预设或自定义服务商。");
		expect(metadata.alternates).toEqual({
			canonical: "/product/models/",
			types: { "text/markdown": "/product/models.md" },
		});
		expect(metadata.openGraph).toMatchObject({
			type: "article",
			siteName: site.title,
			url: "/product/models/",
			title: "配置模型",
			images: [
				{
					url: `${DEFAULT_DOCS_SITE_URL}/opengraph-image/`,
					width: 1200,
					height: 630,
				},
			],
		});
		expect(metadata.twitter).toMatchObject({
			card: "summary_large_image",
			title: "配置模型",
			images: [`${DEFAULT_DOCS_SITE_URL}/opengraph-image/`],
		});
	});

	it("localizes metadata while keeping the public URL language-neutral", () => {
		const metadata = buildPageMetadata({
			title: "Configure models",
			description: "Add and verify a model provider.",
			path: "/product/models",
			locale: "en",
			isHome: false,
		});

		expect(metadata.alternates).toEqual({
			canonical: "/product/models/",
			types: { "text/markdown": "/product/models.md" },
		});
		expect(metadata.title).toEqual({ absolute: "Configure models | Vetta Documentation" });
		expect(metadata.alternates).not.toHaveProperty("languages");
		expect(metadata.openGraph).toMatchObject({
			locale: "en_US",
			siteName: "Vetta Documentation",
			url: "/product/models/",
		});
	});
});

describe("structured data", () => {
	it("builds a JSON-LD graph with required documentation types and absolute URLs", () => {
		const graph = buildPageJsonLd(
			{
				title: "配置模型",
				description: "在设置中添加预设或自定义服务商。",
				path: "/product/models/",
				isHome: false,
				dateModified: "2026-08-01T00:00:00+08:00",
				breadcrumbs: [
					{ name: site.title, path: "/" },
					{ name: "使用指南", path: "/product/" },
					{ name: "配置模型", path: "/product/models/" },
				],
			},
			origin,
		);

		expect(graph["@context"]).toBe("https://schema.org");
		expect(collectSchemaTypes(graph)).toEqual(
			expect.arrayContaining([
				"Organization",
				"SoftwareApplication",
				"WebSite",
				"WebPage",
				"TechArticle",
				"BreadcrumbList",
			]),
		);
		expect(hasDeprecatedSchemaType(graph)).toBe(false);

		const serialized = JSON.stringify(graph);
		expect(serialized).not.toContain("http://schema.org");
		expect(serialized).toContain(`${origin}/product/models/`);
		expect(serialized).toContain(site.githubUrl);
		expect(serialized).toContain("2026-08-01T00:00:00+08:00");

		const breadcrumb = graph["@graph"].find((node) => node["@type"] === "BreadcrumbList");
		const elements = breadcrumb?.itemListElement as Array<{ position: number; item: string }>;
		expect(elements.map((item) => item.position)).toEqual([1, 2, 3]);
		expect(elements.at(-1)?.item).toBe(`${origin}/product/models/`);
	});

	it("builds breadcrumbs from slugs and points sections at their landing pages", () => {
		expect(breadcrumbItemsFromSlugs(["product", "models"], "配置模型")).toEqual([
			{ name: site.title, path: "/" },
			{ name: "使用指南", path: "/product/overview/" },
			{ name: "配置模型", path: "/product/models/" },
		]);
		expect(breadcrumbItemsFromSlugs(["getting-started"], "快速开始")).toEqual([
			{ name: site.title, path: "/" },
			{ name: "快速开始", path: "/getting-started/" },
		]);
		expect(breadcrumbItemsFromSlugs(["examples", "review-and-fix-code"], "示例：审查并修复代码缺陷")).toEqual([
			{ name: site.title, path: "/" },
			{ name: "实战示例", path: "/examples/" },
			{ name: "示例：审查并修复代码缺陷", path: "/examples/review-and-fix-code/" },
		]);
	});

	it("keeps the homepage as WebPage and always starts breadcrumbs at the docs root", () => {
		const items = breadcrumbItemsFromSlugs([], site.title);
		expect(items).toEqual([{ name: site.title, path: "/" }]);

		const types = collectSchemaTypes(
			buildPageJsonLd(
				{
					title: site.title,
					path: "/",
					isHome: true,
					breadcrumbs: items,
				},
				origin,
			),
		);
		expect(types).toContain("WebPage");
		expect(types).not.toContain("TechArticle");
		expect(types).not.toContain("HowTo");
		expect(types).not.toContain("FAQPage");
	});
});

describe("sitemap and robots", () => {
	it("emits canonical HTTPS URLs without priority or changefreq", () => {
		const entries = buildSitemapEntries(
			[
				{ path: "/product/models", lastModified: "2026-08-01T00:00:00+08:00" },
				{ path: "/", lastModified: "2026-07-01T00:00:00+08:00" },
				{ path: "/product/models/" },
			],
			origin,
		);

		expect(entries.map((entry) => entry.url)).toEqual([`${origin}/`, `${origin}/product/models/`]);
		expect(entries[1]?.lastModified).toEqual(new Date("2026-08-01T00:00:00+08:00"));
		expect(entries.every((entry) => !("priority" in entry) && !("changefreq" in entry))).toBe(true);
	});

	it("allows search and AI crawlers and points robots.txt at the sitemap", () => {
		const robots = buildRobotsConfig(origin);
		expect(robots.sitemap).toBe(`${origin}/sitemap.xml`);
		expect(robots.host).toBe(origin);
		expect(robots.rules[0]).toMatchObject({
			userAgent: "*",
			allow: "/",
			disallow: ["/api/"],
		});
		expect(robots.rules[1]?.userAgent).toEqual(
			expect.arrayContaining(["GPTBot", "OAI-SearchBot", "ClaudeBot", "PerplexityBot", "Google-Extended"]),
		);
	});
});
