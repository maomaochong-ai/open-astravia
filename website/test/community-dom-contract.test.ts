// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import { renderPage } from "./render";

/**
 * 社群入口是官网上唯一带二维码的地方：图挂了、颜色对不上，用户就找不到群。
 * 现在二维码只在页脚一份，四个页面共用。
 */
const footer = (() => {
	const markup = renderPage("home");
	const from = markup.indexOf('class="footer__community"');
	expect(from, "页脚缺少社群区块").toBeGreaterThanOrEqual(0);
	return markup.slice(from, markup.indexOf("</footer>"));
})();

describe("社群区块", () => {
	it("并进页脚，页面正文里不再重复一份", () => {
		const body = renderPage("home");
		expect(body.slice(0, body.indexOf("<footer"))).not.toContain("footer__community");
	});

	it("同时给出 QQ 群与微信群两个入口", () => {
		expect(footer).toContain("QQ 群");
		expect(footer).toContain("微信群");
	});

	it("两张二维码都带非空 alt", () => {
		const imgs = [...footer.matchAll(/<img\b[^>]*>/g)].map((m) => m[0]);
		expect(imgs.length).toBe(2);
		for (const tag of imgs) {
			expect(tag, tag).toMatch(/alt="[^"]+"/);
		}
	});

	it("两张码都从 /community/ 取，且是新裁的透明底码", () => {
		const sources = [...footer.matchAll(/<img\b[^>]*src="(\/community\/[^"]+)"/g)].map((m) => m[1]);
		expect(sources).toEqual(["/community/qr-qq.png", "/community/qr-wechat.png"]);
	});

	it("点开大图给出该群的官方海报", () => {
		const posters = [...footer.matchAll(/href="(\/community\/[^"]+)"/g)].map((m) => m[1]);
		expect(new Set(posters)).toEqual(new Set(["/community/qq-group.png", "/community/wechat-group.png"]));
	});
});
