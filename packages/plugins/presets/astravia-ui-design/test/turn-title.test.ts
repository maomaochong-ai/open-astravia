import { describe, expect, it } from "vitest";
import { carryOverTitle, commitTitleFromPrompt, restoreTitle } from "../src/history/turn-title";

describe("commitTitleFromPrompt", () => {
	it("取首行", () => {
		expect(commitTitleFromPrompt("把导航栏改到左侧\n顺便调一下间距")).toBe("把导航栏改到左侧");
	});

	it("跳过开头的空行", () => {
		expect(commitTitleFromPrompt("\n\n  登录页换成深色  \n")).toBe("登录页换成深色");
	});

	it("压掉行内连续空白", () => {
		expect(commitTitleFromPrompt("改   一下    配色")).toBe("改 一下 配色");
	});

	it("超长截断并带省略号", () => {
		const title = commitTitleFromPrompt("改".repeat(80));
		expect(title).toHaveLength(61);
		expect(title.endsWith("…")).toBe(true);
	});

	it("空输入落到兜底标题", () => {
		expect(commitTitleFromPrompt("")).toBe("更新设计");
		expect(commitTitleFromPrompt("   \n  ")).toBe("更新设计");
		expect(commitTitleFromPrompt(null)).toBe("更新设计");
	});
});

describe("carryOverTitle", () => {
	it("上一轮被中断：挂在上一句话名下并标未完成", () => {
		expect(carryOverTitle("把导航栏改到左侧")).toBe("把导航栏改到左侧（未完成）");
	});

	it("没有上一句话：改动只可能来自用户自己", () => {
		expect(carryOverTitle(null)).toBe("手动修改");
		expect(carryOverTitle("  ")).toBe("手动修改");
	});
});

describe("restoreTitle", () => {
	it("恢复是一次新提交，标题指明来源", () => {
		expect(restoreTitle("初始设计")).toBe("恢复到：初始设计");
	});
});
