import { describe, expect, it } from "vitest";
import { createSearchSnippet, findSearchTextRanges, normalizeSearchText } from "./session-search-text.js";

function matches(text: string, query: string): string[] {
	return findSearchTextRanges(text, query).map(({ start, end }) => text.slice(start, end));
}

describe("search text matching", () => {
	it("highlights repeated, case-insensitive literal matches, not regular expressions", () => {
		expect(matches("BUDGET budget Budget", "budget")).toEqual(["BUDGET", "budget", "Budget"]);
		expect(matches("cost [a+b]? [a+b]?", "[a+b]?")).toEqual(["[a+b]?", "[a+b]?"]);
		expect(matches("nothing", "   ")).toEqual([]);
		expect(matches("nothing", "missing")).toEqual([]);
	});

	it("preserves original full-width characters, combining marks and collapsed whitespace", () => {
		expect(matches("  ＢＵＤＧＥＴ\t \n计划", " budget 计划 ")).toEqual(["ＢＵＤＧＥＴ\t \n计划"]);
		expect(matches("cafe\u0301 and café", "CAFÉ")).toEqual(["cafe\u0301", "café"]);
		expect(matches("İstanbul", "i\u0307s")).toEqual(["İs"]);
		expect(matches("ΟΣ and ΟΣ", "ος")).toEqual(["ΟΣ", "ΟΣ"]);
	});

	it("merges hits within one compatibility glyph instead of duplicating original text", () => {
		expect(matches("ﬃ and F", "f")).toEqual(["ﬃ", "F"]);
		expect(matches("ﬃ budget ﬃ", "ffi")).toEqual(["ﬃ", "ﬃ"]);
	});

	it("keeps the keyword visible in long titles and avoids splitting nearby emoji", () => {
		const text = `${"👨‍👩‍👧‍👦".repeat(80)} 预算 ${"👩‍💻".repeat(80)}`;
		const snippet = createSearchSnippet(text, "预算");
		expect(snippet).toContain("预算");
		expect(snippet).toMatch(/^…👨‍👩‍👧‍👦/);
		expect(snippet).toMatch(/👩‍💻…$/);
		expect(matches(snippet, "预算")).toEqual(["预算"]);
	});

	it("uses identical matching rules for snippets and highlighting", () => {
		const text = `${"ﬃ".repeat(200)} ＢＵＤＧＥＴ\n计划 ${"背景".repeat(200)}`;
		const query = "budget 计划";
		const snippet = createSearchSnippet(text, query);
		expect(normalizeSearchText(snippet)).toContain(query);
		expect(matches(snippet, query)).toEqual(["ＢＵＤＧＥＴ\n计划"]);
	});
});
