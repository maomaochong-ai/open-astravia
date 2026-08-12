import { describe, expect, it } from "vitest";
import { DESIGN_IGNORE_LINES, mergeIgnoreLines } from "../src/vetd/design-ignore";

describe("mergeIgnoreLines", () => {
	it("没有文件时写出完整清单", () => {
		expect(mergeIgnoreLines(null)).toBe(`${DESIGN_IGNORE_LINES.join("\n")}\n`);
	});

	it("空文件按没有处理", () => {
		expect(mergeIgnoreLines("\n  \n")).toBe(`${DESIGN_IGNORE_LINES.join("\n")}\n`);
	});

	it("清单已齐时不写", () => {
		expect(mergeIgnoreLines(`${DESIGN_IGNORE_LINES.join("\n")}\n`)).toBeNull();
	});

	it("只补缺的那几行，保留用户已有内容", () => {
		// 老设计的现状：只有截图那一行，.history/ 从来没被写进去过。
		const merged = mergeIgnoreLines("# 我自己加的\n.snapshots/\ndrafts/\n");
		expect(merged).toBe("# 我自己加的\n.snapshots/\ndrafts/\n.history/\n.vetd-build/\nnode_modules/\n.notes.json\n");
	});

	it("原文件没有结尾换行也不会把两行粘在一起", () => {
		const merged = mergeIgnoreLines(".snapshots/");
		expect(merged?.startsWith(".snapshots/\n.history/")).toBe(true);
	});

	it("行首尾空格不算缺失", () => {
		const merged = mergeIgnoreLines(DESIGN_IGNORE_LINES.map((line) => `  ${line}  `).join("\n"));
		expect(merged).toBeNull();
	});
});
