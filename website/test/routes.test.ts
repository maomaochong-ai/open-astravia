// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import { ROUTE_META, ROUTES, normalizePath } from "../src/app/router";
import { renderPage } from "./render";

/**
 * 官网从「一个 tab 一个静态 HTML」改成了客户端路由：
 * 四个页面共用一个 index.html，靠地址栏区分。
 * 这里钉住路由表、标题与导航目标——新增页面忘了登记、导航指向不存在的路径都会失败。
 */
describe("路由表", () => {
	it("登记了产品 / 功能 / 下载 / 关于四个路径", () => {
		expect([...ROUTES]).toEqual(["/", "/features", "/download", "/about"]);
	});

	it("每个路径都有标题与描述", () => {
		for (const path of ROUTES) {
			expect(ROUTE_META[path].title.length).toBeGreaterThan(4);
			expect(ROUTE_META[path].description.length).toBeGreaterThan(10);
		}
		// 首页标题带完整的品牌主张，其余页面用「栏目 · 品牌」的形状。
		expect(ROUTE_META["/"].title).toContain("Astravia");
		expect(ROUTE_META["/features"].title).toBe("功能 · Astravia");
		expect(ROUTE_META["/about"].title).toBe("关于 · Astravia");
	});

	it("未知路径回落到首页，尾斜杠被规范化", () => {
		expect(normalizePath("/nope")).toBe("/");
		expect(normalizePath("/features/")).toBe("/features");
		expect(normalizePath("")).toBe("/");
		expect(normalizePath("/download")).toBe("/download");
	});
});

describe("导航", () => {
	const markup = renderPage("home");

	it("主导航覆盖四个站内页面，并保留文档外链", () => {
		for (const href of ['href="/"', 'href="/features"', 'href="/download"', 'href="/about"']) {
			expect(markup).toContain(href);
		}
		expect(markup).toContain('href="https://docs.astravia.dev"');
	});

	it("站内链接不出现 .html 后缀", () => {
		expect([...markup.matchAll(/href="([^"]*\.html)"/g)].map((m) => m[1])).toEqual([]);
	});

	it("站内绝对链接要么是路由，要么指向 public 下的文件", () => {
		const hrefs = [...new Set([...markup.matchAll(/href="(\/[^"#?]*)"/g)].map((m) => m[1]))];
		const unknown = hrefs.filter(
			(href) => !(ROUTES as readonly string[]).includes(href as never) && !/\.[a-z0-9]+$/i.test(href),
		);
		expect(unknown, `以下链接既不是路由也不是文件：\n${unknown.join("\n")}`).toEqual([]);
	});
});

describe("外链", () => {
	const markup = renderPage("home");

	it("每个新窗口链接都带 noopener", () => {
		const tags = [...markup.matchAll(/<a\b[^>]*target="_blank"[^>]*>/g)].map((m) => m[0]);
		expect(tags.length).toBeGreaterThan(0);
		for (const tag of tags) {
			// 二维码海报是站内文件，也走新窗口；外站则必须是完整 http(s) 地址。
			expect(tag).toMatch(/rel="noopener noreferrer"/);
			expect(tag).toMatch(/href="(?:https?:\/\/|\/)[^"]+"/);
		}
	});
});
