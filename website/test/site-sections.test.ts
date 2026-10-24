import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// 测试始终从 website 包目录运行：bun run test 与 scripts/quality/* 都是这样调用。
const indexHtml = readFileSync(resolve("index.html"), "utf8");

function sectionHtml(id: string): string {
	const variants = [`<section class="section" id="${id}"`, `<section class="section section--tint" id="${id}"`];
	const from = variants.map((needle) => indexHtml.indexOf(needle)).find((index) => index >= 0) ?? -1;
	expect(from, `缺少 #${id} 区块`).toBeGreaterThanOrEqual(0);
	const end = indexHtml.indexOf("</section>", from);
	return indexHtml.slice(from, end);
}

/**
 * 首页是静态标记，改版时最容易悄悄丢的东西是区块顺序、条目数量和文案来源。
 * 这里钉住 0.5.76 对齐上游时定下的约束，避免下次改版又退回旧结构。
 */
describe("首页区块结构", () => {
	it("区块顺序为 生态 → 知识库 → 定价 → 隐私 → FAQ", () => {
		const order = ["ecosystem", "knowledge", "pricing", "privacy", "faq"].map((id) => indexHtml.indexOf(`id="${id}"`));
		expect(order.every((index) => index >= 0)).toBe(true);
		expect([...order].sort((left, right) => left - right)).toEqual(order);
	});

	it("知识库是四步流程，并说明数据留在本机", () => {
		const html = sectionHtml("knowledge");
		expect([...html.matchAll(/class="step reveal"/g)]).toHaveLength(4);
		for (const title of ["放入", "整理", "找到", "回答"]) {
			expect(html).toContain(`<h3 class="step__title">${title}</h3>`);
		}
		expect(html).toContain("~/.astravia");
	});

	it("定价只有开源版与企业定制两条，且不写具体金额", () => {
		const html = sectionHtml("pricing");
		expect([...html.matchAll(/<article class="plan/g)]).toHaveLength(2);
		expect(html).toContain("免费");
		expect(html).toContain("按范围报价");
		// 不自造付费档：出现金额就说明有人把上游 Pro/Max 抄回来了
		expect(html).not.toMatch(/\$\d/);
		expect(html).not.toMatch(/\d+\s*\/\s*月/);
		expect(html).toContain('href="#download"');
	});

	it("隐私区沿用「为掌控而设计」三张承诺卡", () => {
		const html = sectionHtml("privacy");
		expect(html).toContain("为掌控而设计");
		for (const title of ["数据安全", "模型自由", "可扩展平台"]) {
			expect(html).toContain(`<h3 class="promise__title">${title}</h3>`);
		}
	});

	it("FAQ 是七个问题，且不残留上游品牌名", () => {
		const html = sectionHtml("faq");
		expect([...html.matchAll(/<details class="faq__item">/g)]).toHaveLength(7);
		expect(html).toContain("<summary>什么是星轨 Astravia？</summary>");
		expect(html).not.toMatch(/Vetta|Vivi/);
	});

	it("页脚产品栏能跳到知识库与定价", () => {
		for (const href of ["#knowledge", "#pricing"]) {
			expect(indexHtml).toContain(`<a href="${href}">`);
		}
	});
});
