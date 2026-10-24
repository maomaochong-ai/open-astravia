import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { openExternalLink } from "../src/external-links";

function deps(opened: Window | null) {
	const calls = { opened: [] as string[], assigned: [] as string[] };
	return {
		calls,
		deps: {
			open: (href: string) => {
				calls.opened.push(href);
				return opened;
			},
			assign: (href: string) => {
				calls.assigned.push(href);
			},
		},
	};
}

/**
 * 文档导航曾出现「点下去毫无反应」：外链靠 target="_blank"，被弹窗策略吞掉后既不开窗也不跳转。
 * 下面的用例钉住兜底行为——拿不到新窗口时必须在当前页跳转。
 */
describe("外链点击的兜底", () => {
	it("开得出新窗口时不改当前页", () => {
		const fake = deps({} as Window);
		expect(openExternalLink("https://docs.astravia.dev", fake.deps)).toBe("new-window");
		expect(fake.calls.opened).toEqual(["https://docs.astravia.dev"]);
		expect(fake.calls.assigned).toEqual([]);
	});

	it("窗口被拦下时退回当前页跳转", () => {
		const fake = deps(null);
		expect(openExternalLink("https://docs.astravia.dev", fake.deps)).toBe("same-tab");
		expect(fake.calls.opened).toEqual(["https://docs.astravia.dev"]);
		expect(fake.calls.assigned).toEqual(["https://docs.astravia.dev"]);
	});
});

/** 兜底只挂在 `a[target="_blank"]` 上；写 `target="blank"`（少了下划线）或漏掉 target 都会静默漏掉。 */
describe("外链锚点的 DOM 契约", () => {
	const indexHtml = readFileSync(resolve("index.html"), "utf8");
	const blankTargets = [...indexHtml.matchAll(/<a\b[^>]*target="_blank"[^>]*>/g)].map((m) => m[0]);

	it("页面里存在外链锚点", () => {
		expect(blankTargets.length).toBeGreaterThan(0);
	});

	it("每个新窗口锚点都有可跳转的 href", () => {
		for (const tag of blankTargets) {
			// 外站写完整 http(s)，站内大图写根路径；两种都能交给 window.open / location.assign。
			expect(tag, tag).toMatch(/href="(?:https?:\/\/|\/)[^"]+"/);
		}
	});

	it("文档入口指向文档站", () => {
		expect(indexHtml).toContain('<a href="https://docs.astravia.dev" target="_blank"');
	});
});
