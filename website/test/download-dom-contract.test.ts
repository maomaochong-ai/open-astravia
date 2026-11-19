// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import { DOWNLOAD_VERSION } from "../src/pages/download";
import { renderPage } from "./render";

const download = renderPage("download");
const home = renderPage("home");

function countClass(html: string, name: string): number {
	return [...html.matchAll(/<[a-z][^>]*class="([^"]*)"/g)].filter((m) => m[1].split(/\s+/).includes(name)).length;
}

/**
 * 下载入口由运行时按系统与芯片改写，元素 id 改名不会有编译期报错。
 * 这里把组件依赖的锚点与「只出现一份安装包列表」钉住。
 */
describe("下载入口的 DOM 契约", () => {
	it("保留运行时写入的元素 id", () => {
		for (const id of ["dlPrimary", "dlPrimaryText", "dlPrimaryVersion", "dlOthersToggle", "dlOthers"]) {
			expect(download).toContain(`id="${id}"`);
		}
	});

	it("主下载按钮只有一处", () => {
		expect(countClass(download, "dl-primary")).toBe(1);
	});

	it("首页与页头都不挂安装包链接", () => {
		expect(home).not.toContain("dl.astravia.dev");
		expect(home).toContain('href="/download"');
	});

	it("页面里所有产物链接与 DOWNLOAD_VERSION 一致", () => {
		const versioned = [...download.matchAll(/https:\/\/dl\.astravia\.dev\/app\/v([^/]+)\//g)].map((m) => m[1]);
		expect(versioned.length).toBeGreaterThan(0);
		expect(new Set(versioned)).toEqual(new Set([DOWNLOAD_VERSION]));
	});

	it("版本号只出现在下载页", () => {
		for (const page of ["features", "about"] as const) {
			expect(renderPage(page)).not.toContain(DOWNLOAD_VERSION);
		}
		expect(home).not.toContain(DOWNLOAD_VERSION);
	});
});
