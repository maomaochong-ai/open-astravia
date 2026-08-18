import { describe, expect, it } from "vitest";
import { parseFrontmatter, rewriteFrontmatterDescription } from "./skill-frontmatter";

describe("parseFrontmatter", () => {
	it("从 metadata 块读出 scene 类型", () => {
		const fm = parseFrontmatter(
				"\n",
			),
		);
		expect(fm.type).toBe("scene");
	});

	it("metadata.type 缺省时不给出类型（由调用方按 skill 兜底）", () => {
		const fm = parseFrontmatter(["---", "name: demo", "description: d", "---"].join("\n"));
		expect(fm.type).toBeUndefined();
	});

	it("不认 metadata 块之外的同名 type 键", () => {
		// agent 侧只读 metadata.type，顶层 type 在两边都不成立，不能让 desktop 单方面认。
		const fm = parseFrontmatter(["---", "name: demo", "description: d", "type: scene", "---"].join("\n"));
		expect(fm.type).toBeUndefined();
	});

	it("metadata 块结束后不再继续找 type", () => {
		const fm = parseFrontmatter(
			[
				"---",
				"name: demo",
				"description: d",
				"metadata:",
				"  version: 1.0.0",
				"other:",
				"  type: scene",
				"---",
			].join("\n"),
		);
		expect(fm.type).toBeUndefined();
	});

	it("无法识别的 metadata.type 按缺省处理", () => {
		const fm = parseFrontmatter(
			["---", "name: demo", "description: d", "metadata:", "  type: workflow", "---"].join("\n"),
		);
		expect(fm.type).toBeUndefined();
	});

	it("折叠块 description 拼成整段，而不是取到一个 '>'", () => {
		const fm = parseFrontmatter(
			[
				"---",
				"name: demo",
				"description: >",
				"  第一行内容，",
				"  第二行内容。",
				"metadata:",
				"  type: scene",
				"---",
			].join("\n"),
		);
		expect(fm.description).toBe("第一行内容， 第二行内容。");
		expect(fm.type).toBe("scene");
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
