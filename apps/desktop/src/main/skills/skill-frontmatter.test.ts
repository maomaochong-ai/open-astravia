import { describe, expect, it } from "vitest";
import { parseFrontmatter, rewriteFrontmatterDescription } from "./skill-frontmatter";

describe("parseFrontmatter", () => {
	it("折叠块 description 拼成整段，而不是取到一个 '>'", () => {
		const fm = parseFrontmatter(
			["---", "name: demo", "description: >", "  第一行内容，", "  第二行内容。", "metadata:", "---"].join("\n"),
		);
		expect(fm.description).toBe("第一行内容， 第二行内容。");
	});

	it("读取 metadata 下的 version 与顶层 name/alias", () => {
		const fm = parseFrontmatter(
			["---", "name: demo", "alias: 演示", "description: d", "metadata:", '  version: "0.5.5"', "---"].join("\n"),
		);
		expect(fm).toMatchObject({ name: "demo", alias: "演示", version: "0.5.5" });
	});
});

describe("rewriteFrontmatterDescription", () => {
	it("把单行 description 改写为 double-quoted", () => {
		const source = ["---", "name: demo", "description: 带: 冒号", "---", "", "正文"].join("\n");
		expect(rewriteFrontmatterDescription(source, "带: 冒号")).toContain('description: "带: 冒号"');
	});

	it("折叠块 description 原样保留（改写会把续行变成孤儿）", () => {
		const source = ["---", "name: demo", "description: >", "  第一行，", "  第二行。", "---", "", "正文"].join("\n");
		expect(rewriteFrontmatterDescription(source, "第一行， 第二行。")).toBe(source);
	});
});
