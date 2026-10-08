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

	it("导航与 Hero 的下载按钮选择器各自唯一命中", () => {
		expect(countClassMatches(indexHtml, ["nav__download"])).toBe(1);
		expect(countClassMatches(indexHtml, ["btn--primary", "btn--lg"])).toBe(1);
	});

	it("保留平台图标容器", () => {
		expect(countClassMatches(indexHtml, ["dl-platform-icon"])).toBeGreaterThan(0);
	});
});
