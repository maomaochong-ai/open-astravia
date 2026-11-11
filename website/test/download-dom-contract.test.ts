import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// 测试始终从 website 包目录运行：bun run test 与 scripts/quality/* 都是这样调用。
const indexHtml = readFileSync(resolve("index.html"), "utf8");

function countClassMatches(html: string, classes: readonly string[]): number {
	return [...html.matchAll(/<[a-z][^>]*\sclass="([^"]*)"/g)]
		.map((match) => match[1])
		.filter((value) => classes.every((name) => value.split(/\s+/).includes(name))).length;
}

/**
 * 下载入口由 JS 按系统和芯片改写，元素 id / class 改名不会有编译期报错。
 * 这里把 JS 依赖的锚点钉住，避免改版时静默退回静态默认值。
 */
describe("下载入口的 DOM 契约", () => {
	it("保留 JS 写入的元素 id", () => {
		for (const id of ["dlPrimary", "dlPrimaryText", "dlPrimaryVersion"]) {
			expect(indexHtml).toContain(`id="${id}"`);
		}
	});

	it("导航只给页内锚点，安装包链接只出现在下载区", () => {
		expect(countClassMatches(indexHtml, ["nav__download"])).toBe(0);
		// 首屏用「开始使用」锚点落到下载区，不直接挂二进制：版本与架构判定只留一个事实源。
		expect(countClassMatches(indexHtml, ["dl__primary", "btn--lg"])).toBe(1);
	});

	it("Hero 的 CTA 指向下载区而不是某个安装包", () => {
		const hero = indexHtml.slice(indexHtml.indexOf('class="hero"'), indexHtml.indexOf('id="platform"'));
		expect(hero).toContain('href="#download"');
		expect(hero).not.toContain("dl.astravia.dev");
	});

	it("保留平台图标容器", () => {
		expect(countClassMatches(indexHtml, ["dl-platform-icon"])).toBeGreaterThan(0);
	});
});
