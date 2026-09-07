import { toCsv, toMarkdown } from "@vetta/theme-ui/shared";
import { describe, expect, it } from "vitest";

/** 表格工具条的「复制为 Markdown / CSV」纯逻辑。theme-ui 侧没有测试 runner，落在宿主跑。 */
describe("toMarkdown", () => {
	it("emits a GFM table with a delimiter row", () => {
		expect(
			toMarkdown([
				["区域", "营收"],
				["华东", "4,680.50"],
			]),
		).toBe("| 区域 | 营收 |\n| --- | --- |\n| 华东 | 4,680.50 |");
	});

	it("pads short rows so every line keeps the same column count", () => {
		expect(toMarkdown([["a", "b", "c"], ["x"]])).toBe("| a | b | c |\n| --- | --- | --- |\n| x |  |  |");
	});

	it("escapes pipes so a cell cannot break out of its column", () => {
		expect(toMarkdown([["a|b"], ["c"]])).toBe("| a\\|b |\n| --- |\n| c |");
	});

	it("returns an empty string for an empty table", () => {
		expect(toMarkdown([])).toBe("");
	});
});

describe("toCsv", () => {
	it("leaves plain values unquoted", () => {
		expect(
			toCsv([
				["a", "b"],
				["1", "2"],
			]),
		).toBe("a,b\n1,2");
	});

	it("quotes values containing a comma, quote or newline", () => {
		expect(toCsv([["4,680", 'say "hi"', "one\ntwo"]])).toBe('"4,680","say ""hi""","one\ntwo"');
	});
});
