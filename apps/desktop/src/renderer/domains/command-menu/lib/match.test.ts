import { describe, expect, it } from "vitest";
import { matchCommandMenuEntry, mergeHighlightRanges, tokenizeCommandMenuQuery } from "./match";

describe("tokenizeCommandMenuQuery", () => {
	it("splits on any whitespace run and normalizes case and width", () => {
		expect(tokenizeCommandMenuQuery("  Settings   语言 ")).toEqual(["settings", "语言"]);
		// NFKC：全角字母与半角等价，否则中文输入法下敲出的 ASCII 会搜不到。
		expect(tokenizeCommandMenuQuery("ＧＩＴ")).toEqual(["git"]);
	});

	it("treats an empty or whitespace-only query as no tokens", () => {
		expect(tokenizeCommandMenuQuery("")).toEqual([]);
		expect(tokenizeCommandMenuQuery("   ")).toEqual([]);
	});
});

describe("mergeHighlightRanges", () => {
	it("merges overlapping and touching ranges, keeping disjoint ones apart", () => {
		expect(
			mergeHighlightRanges([
				{ start: 5, end: 8 },
				{ start: 0, end: 3 },
				{ start: 2, end: 6 },
			]),
		).toEqual([{ start: 0, end: 8 }]);

		expect(
			mergeHighlightRanges([
				{ start: 0, end: 2 },
				{ start: 4, end: 6 },
			]),
		).toEqual([
			{ start: 0, end: 2 },
			{ start: 4, end: 6 },
		]);
	});

	it("returns the input untouched when there is nothing to merge", () => {
		expect(mergeHighlightRanges([])).toEqual([]);
		expect(mergeHighlightRanges([{ start: 1, end: 2 }])).toEqual([{ start: 1, end: 2 }]);
	});
});

describe("matchCommandMenuEntry", () => {
	const entry = { title: "界面主题", subtitle: "外观" };

	it("passes everything with a score of zero when there are no tokens", () => {
		const match = matchCommandMenuEntry(entry, []);
		expect(match).toEqual({ score: 0, titleHighlights: [], subtitleHighlights: [] });
	});

	it("requires every token to hit, in any order and without being adjacent", () => {
		expect(matchCommandMenuEntry(entry, ["主题", "外观"])).not.toBeNull();
		expect(matchCommandMenuEntry(entry, ["外观", "主题"])).not.toBeNull();
		// 任一 token 落空即整条不匹配（AND 语义）。
		expect(matchCommandMenuEntry(entry, ["主题", "语言"])).toBeNull();
	});

	it("matches substrings only, never a fuzzy subsequence", () => {
		// 与主进程会话检索保持一致：includes 语义。
		expect(matchCommandMenuEntry({ title: "Command Menu" }, ["cm"])).toBeNull();
		expect(matchCommandMenuEntry({ title: "Command Menu" }, ["comm"])).not.toBeNull();
	});

	it("ranks a prefix hit above a word-start hit above a mid-word hit", () => {
		const prefix = matchCommandMenuEntry({ title: "git-demo" }, ["git"]);
		const wordStart = matchCommandMenuEntry({ title: "my-git" }, ["git"]);
		const anywhere = matchCommandMenuEntry({ title: "legitimate" }, ["git"]);

		expect(prefix?.score).toBeGreaterThan(wordStart?.score ?? 0);
		expect(wordStart?.score).toBeGreaterThan(anywhere?.score ?? 0);
	});

	it("scores a subtitle-only hit below any title hit", () => {
		const titleHit = matchCommandMenuEntry({ title: "语言", subtitle: "外观" }, ["语言"]);
		const subtitleHit = matchCommandMenuEntry({ title: "语言", subtitle: "外观" }, ["外观"]);

		expect(subtitleHit?.score).toBeLessThan(titleHit?.score ?? 0);
		expect(subtitleHit?.titleHighlights).toEqual([]);
		expect(subtitleHit?.subtitleHighlights).toEqual([{ start: 0, end: 2 }]);
	});

	it("returns merged highlight ranges when two tokens cover the same span", () => {
		const match = matchCommandMenuEntry({ title: "openvetta" }, ["open", "openv"]);
		expect(match?.titleHighlights).toEqual([{ start: 0, end: 5 }]);
	});

	it("highlights every occurrence of a token, not just the first", () => {
		const match = matchCommandMenuEntry({ title: "git git" }, ["git"]);
		expect(match?.titleHighlights).toEqual([
			{ start: 0, end: 3 },
			{ start: 4, end: 7 },
		]);
	});

	it("keeps highlight offsets aligned with the original CJK text", () => {
		const match = matchCommandMenuEntry({ title: "快捷键设置" }, ["设置"]);
		expect(match?.titleHighlights).toEqual([{ start: 3, end: 5 }]);
	});
});
