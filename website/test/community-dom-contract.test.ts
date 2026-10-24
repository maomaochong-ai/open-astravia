import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 社群入口是官网上唯一带二维码的区块：图挂了、锚点写错、导航没挂上 data-nav，
 * 用户就找不到群。二维码现在并进页脚，这里按 index.html 的实际结构钉住这几件事。
 */
const indexHtml = readFileSync(resolve("index.html"), "utf8");
const mainTs = readFileSync(resolve("src/main.ts"), "utf8");

const footerHtml = indexHtml.slice(indexHtml.indexOf("<footer"));
const communityHtml = footerHtml.slice(footerHtml.indexOf('id="community"'));

describe("社群区块", () => {
	it("并进页脚，而不是单独一段", () => {
		const communityAt = indexHtml.indexOf('id="community"');
		const footerAt = indexHtml.indexOf("<footer");
		expect(footerAt).toBeGreaterThan(-1);
		expect(communityAt).toBeGreaterThan(footerAt);
		expect(indexHtml.slice(0, footerAt)).not.toContain('id="community"');
	});

	it("同时给出 QQ 群与微信群两个入口", () => {
		expect(communityHtml).toContain("QQ 群");
		expect(communityHtml).toContain("微信群");
	});

	it("两张二维码都带非空 alt", () => {
		const imgs = [...communityHtml.matchAll(/<img\b[^>]*>/g)].map((m) => m[0]);
		expect(imgs.length).toBe(2);
		for (const tag of imgs) {
			expect(tag, tag).toMatch(/alt="[^"]+"/);
		}
	});
});

describe("二维码资源", () => {
	const sources = [...communityHtml.matchAll(/<img\b[^>]*src="(\/community\/[^"]+)"/g)].map((m) => m[1]);

	it("两张码都从 /community/ 取，且是新裁的透明底码而不是整张海报", () => {
		expect(sources).toEqual(["/community/qr-qq.png", "/community/qr-wechat.png"]);
	});

	it("文件真的存在于 public/ 下", () => {
		for (const src of sources) {
			expect(existsSync(resolve("public", src.replace(/^\//, ""))), src).toBe(true);
		}
	});

	it("点开大图会按主题给出对应底色的海报", () => {
		const posters = [...communityHtml.matchAll(/data-poster-(?:dark|light)="(\/community\/[^"]+)"/g)].map((m) => m[1]);
		expect(new Set(posters)).toEqual(
			new Set([
				"/community/qq-group.png",
				"/community/wechat-group.png",
				"/community/wechat-group-light.png",
			]),
		);
		for (const src of posters) {
			expect(existsSync(resolve("public", src.replace(/^\//, ""))), src).toBe(true);
		}
	});

	it("主题切换时会把海报 href 换成对应底色那张", () => {
		expect(mainTs).toContain('a.qr-card[data-poster-dark][data-poster-light]');
		expect(mainTs).toMatch(/applyCommunityPosters\(getCurrentTheme\(\)\)/);
		expect(mainTs).toMatch(/applyCommunityPosters\(next\)/);
	});
});

describe("社群入口的导航接线", () => {
	it("主导航里有带 data-nav 的社群项（滚动高亮靠它）", () => {
		expect(indexHtml).toContain('<a href="#community" data-nav="community">社群</a>');
	});

	it("页脚不再重复挂一个指向自己的社群链接", () => {
		expect(footerHtml).not.toContain('<a href="#community">社群</a>');
	});
});
