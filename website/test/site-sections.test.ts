// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import { renderPage } from "./render";

/** 取某个 `data-section` 包裹的区块标记。 */
function section(markup: string, name: string): string {
	const from = markup.indexOf(`data-section="${name}"`);
	expect(from, `缺少 ${name} 区块`).toBeGreaterThanOrEqual(0);
	const start = markup.lastIndexOf("<section", from);
	const end = markup.indexOf("</section>", from);
	return markup.slice(start, end);
}


const home = renderPage("home");
const features = renderPage("features");
const download = renderPage("download");
const about = renderPage("about");

/**
 * 断言的是渲染结果里的内容与事实，不是某个类名或版式——版式可以继续对齐参考站，
 * 这些不能丢。
 */
describe("产品首页", () => {
	it("区块顺序为 隐私 / 走查 / 扩展 / 知识库 / FAQ", () => {
		const marks = ["你的数据。", "看见工作如何", "天生可扩展。", "你已有的资料", "开始使用前"].map((text) =>
			home.indexOf(text),
		);
		expect(marks.every((index) => index >= 0)).toBe(true);
		expect([...marks].sort((a, b) => a - b)).toEqual(marks);
	});

	it("首屏是「文字 + 吉祥物」两栏，服务商条循环滚动", () => {
		const hero = home.slice(home.indexOf('class="hero"'), home.indexOf("你的数据。"));
		expect(hero).toContain("/mascot/hero.webp");
		expect(hero).toContain('class="hero__marquee-track"');
		// 跑马灯靠两份相同清单首尾相接，缺一份就会在拼接处出现空档。
		expect([...hero.matchAll(/class="provider-strip"/g)]).toHaveLength(2);
	});

	it("生态区中心是角色本身，左右两列分别接技能与插件", () => {
		const html = section(home, "ecosystem");
		expect(html).toContain('class="eco__hub reveal"');
		expect(html).toContain("/mascot/icon.webp");
		for (const name of ["研究", "数据智能", "自动化", "官方插件", "社区插件", "自定义插件"]) {
			expect(html).toContain(name);
		}
	});

	it("知识库用文件卡 + 角色，过程四步在同一块面板里", () => {
		const html = section(home, "knowledge");
		expect(html).toContain("/mascot/laptop.webp");
		expect([...html.matchAll(/class="kb-card__row"/g)]).toHaveLength(5);
		expect(html).toContain('class="kb-panel is-active"');
	});

	it("收尾用五张角色片子拼贴，并给出两个入口", () => {
		const html = section(home, "closing");
		expect([...html.matchAll(/class="collage__frame /g)]).toHaveLength(5);
		for (const name of ["laptop", "headphones", "tea", "dumbbell", "sleep"]) {
			expect(html).toContain(`/mascot/${name}.webp`);
		}
		expect(html).toContain("你好，我叫毛毛虫");
		expect(html).toContain('href="/download"');
		expect(html).toContain("github.com/maomaochong-ai/open-astravia");
	});

	it("首屏有可读的产品主张与下载入口", () => {
		const h1 = home.match(/<h1[^>]*>([\s\S]*?)<\/h1>/);
		const text = (h1?.[1] ?? "").replace(/<[^>]+>/g, "").trim();
		expect(text).toContain("开源 Agent");
		expect(home.slice(0, home.indexOf("你的数据。"))).toContain('href="/download"');
	});

	it("任务走查是五个步骤，点一步换一块面板", () => {
		const html = section(home, "journey");
		expect([...html.matchAll(/class="step-card[ "]/g)]).toHaveLength(5);
		expect(html).toContain("提出需求");
		expect(html).toContain("知识沉淀");
		// 默认停在第 1 步，面板里应该出现对应的应用首页 mock。
		expect(html).toContain("今天想完成什么？");
	});

	it("扩展区是三段面板 + 连接图 + 11 个预装插件", () => {
		const html = section(home, "ecosystem");
		expect([...html.matchAll(/class="rail-panel[ "]/g)]).toHaveLength(3);
		expect(html).toContain("构建技能");
		expect(html).toContain("用插件扩展");
		expect(html).toContain("连接工具");
		expect(html).toContain("SKILL.md");
		expect([...html.matchAll(/src="\/plugins\/[^"]+"/g)]).toHaveLength(11);
		expect(html).toContain('class="orbit__links"');
	});

	it("知识库是四步流程，并说明数据留在本机", () => {
		const html = section(home, "knowledge");
		for (const label of ["放入", "整理", "找到", "回答"]) {
			expect(html).toContain(label);
		}
		expect(html).toContain("永不用于训练模型");
		expect(html).toContain("资料在你这边");
	});

	it("FAQ 是五个问题，默认回答第一个", () => {
		const html = section(home, "faq");
		expect([...html.matchAll(/class="faq-q/g)]).toHaveLength(5);
		expect(html).toContain("什么是星轨 Astravia？");
		// 默认展开第一条：会话区里应当已经带着它的回答。
		expect(html).toContain("本地优先的 AI Agent 桌面应用");
	});
});

describe("功能页", () => {
	it("Work / Coding 两档切换，默认 Work", () => {
		expect(features).toContain("让 Astravia 协助你的日常工作");
		// 两档按钮始终渲染，默认选中 Work。
		expect(features).toContain(">Work</span>");
		expect(features).toContain(">Coding</span>");
		expect(features).toMatch(/aria-selected="true"/);
	});

	it("四条日常事务都给出 mock", () => {
		for (const label of ["邮件处理", "文档撰写", "表格整理", "日程与待办"]) {
			expect(features).toContain(label);
		}
		expect(features).toContain("收件箱");
	});

	it("Work 侧包含多形态回答、批量任务与能力广场", () => {
		expect(features).toContain("丰富的回答");
		expect(features).toContain("上百个任务一次交给 Astravia");
		expect(features).toContain("能力广场");
	});

	it("共用区块：并行工作流、主动澄清、工具箱", () => {
		expect(features).toContain("把大任务拆成可并行的子任务");
		expect(features).toContain("遇到分叉，先问你，而不是瞎猜");
		expect(features).toContain("为日常工作与开发打造的完整工具箱");
		expect([...features.matchAll(/class="tool-card reveal"/g)]).toHaveLength(16);
	});
});

describe("下载页", () => {
	it("首屏是居中的大标题与推荐版本", () => {
		expect(download).toContain('<h1 class="dl-hero__title reveal">下载</h1>');
		expect(download).toContain('id="dlPrimary"');
		expect(download).toContain('id="dlPrimaryText"');
	});

	it("桌面三平台与手机端入口都在", () => {
		for (const name of ["macOS", "Windows", "Linux"]) {
			expect(download).toContain(`>${name}</h2>`);
		}
		expect(download).toContain('id="dlMobile"');
		expect(download).toContain('id="mobIosHref"');
		expect(download).toContain('id="mobAndroidHref"');
	});

	it("手机端文案说清楚签名与配对，不再罗列多余步骤", () => {
		expect(download).toContain("Apple ID 签名");
		expect(download).toContain("手机扫码连接");
	});
});

describe("关于页", () => {
	it("是独立页面，四个编号段落都在", () => {
		expect(about).toContain("大家好，我叫毛毛虫");
		expect(about).toContain("为真实工作而生的开源 AI Agent");
		for (const num of ["01", "02", "03", "04"]) {
			expect(about).toContain(`>${num}</span>`);
		}
		expect(about).toContain("为什么选择开源");
	});

	it("不插图：关于页只讲文字，深浅主题的截图留在首页", () => {
		expect(about).not.toContain("/app/app-dark.webp");
		expect(about).not.toContain("/plugins/");
	});
});

describe("品牌口径", () => {
	it("任何页面都不出现竞品名称或衍生表述", () => {
		for (const page of [home, features, download, about]) {
			expect(page).not.toMatch(/Vetta|Vivi|openvetta/i);
		}
	});

	it("保留开源与本地优先的事实表述", () => {
		expect(home).toContain("Apache-2.0");
		expect(home).toContain("本地优先 · 模型自配 · 数据自持");
	});
});
