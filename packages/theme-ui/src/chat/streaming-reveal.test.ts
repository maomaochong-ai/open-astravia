import { describe, expect, test } from "vitest";
import {
	HOLD_MAX_MS,
	holdBackUnclosedInline,
	nextPhraseEnd,
	planReveal,
	snapToTokenBoundary,
	splitStreamingSegments,
} from "./streaming-reveal";

describe("nextPhraseEnd", () => {
	test("ends a phrase after latin punctuation followed by whitespace", () => {
		expect(nextPhraseEnd("Hello there, world", 0, false)).toBe("Hello there,".length);
	});

	test("keeps trailing latin punctuation pending until the next character arrives", () => {
		expect(nextPhraseEnd("Hello there,", 0, false)).toBeNull();
		expect(nextPhraseEnd("Hello there,", 0, true)).toBe("Hello there,".length);
	});

	test("does not break inside numbers or dotted words", () => {
		expect(nextPhraseEnd("pi is 3.14 and more", 0, false)).toBeNull();
	});

	test("ends a phrase after CJK punctuation including closing quotes", () => {
		expect(nextPhraseEnd("他说：“秋天到了。”然后走了", 0, false)).toBe("他说：".length);
		expect(nextPhraseEnd("他说：“秋天到了。”然后走了", 3, false)).toBe("他说：“秋天到了。”".length);
	});

	test("ends a phrase at a newline", () => {
		expect(nextPhraseEnd("const a = 1\nconst b", 0, false)).toBe("const a = 1\n".length);
	});

	test("treats an unfinished tail as pending unless final", () => {
		expect(nextPhraseEnd("still typing", 0, false)).toBeNull();
		expect(nextPhraseEnd("still typing", 0, true)).toBe("still typing".length);
	});

	test("caps long unpunctuated runs, preferring whitespace", () => {
		const latin = "word ".repeat(30);
		const end = nextPhraseEnd(latin, 0, false);
		expect(end).not.toBeNull();
		expect(end).toBeLessThanOrEqual(48);
		expect(latin[end as number]).toBe(" ");

		const cjk = "秋".repeat(100);
		expect(nextPhraseEnd(cjk, 0, false)).toBe(48);
	});

	test("does not split a surrogate pair when capping", () => {
		const text = `${"秋".repeat(47)}😀tail`;
		expect(nextPhraseEnd(text, 0, false)).toBe(49);
	});
});

describe("splitStreamingSegments", () => {
	test("round-trips the source text", () => {
		const text = "Hello, world! 你好世界，这是流式输出。\n  indented 3.14 and more";
		expect(splitStreamingSegments(text).join("")).toBe(text);
	});

	test("splits into phrases with leading whitespace attached", () => {
		expect(splitStreamingSegments("As twilight falls, the city wakes. Lights flicker")).toEqual([
			"As twilight falls,",
			" the city wakes.",
			" Lights flicker",
		]);
	});

	test("keeps earlier segments stable as text grows by whole phrases", () => {
		const before = splitStreamingSegments("秋天来了，天气凉了，");
		const after = splitStreamingSegments("秋天来了，天气凉了，树叶黄了。");
		expect(after.slice(0, before.length)).toEqual(before);
	});
});

describe("snapToTokenBoundary", () => {
	test("never splits a latin word or a number", () => {
		expect(snapToTokenBoundary("hello world", 3)).toBe("hello".length);
		expect(snapToTokenBoundary("pi is 3.14159 ok", 9)).toBe("pi is 3.14159".length);
		expect(snapToTokenBoundary("hello world", 5)).toBe(5);
		expect(snapToTokenBoundary("hello world", 6)).toBe(6);
	});

	test("treats every CJK character as a boundary", () => {
		expect(snapToTokenBoundary("你好世界", 2)).toBe(2);
	});

	test("does not split a surrogate pair", () => {
		expect(snapToTokenBoundary("a😀b", 2)).toBe(3);
	});
});

describe("holdBackUnclosedInline", () => {
	test("holds inline math and matching backtick runs without interpreting their content as links", () => {
		for (const text of ["Value $x + y", "Value $$x + y", "Use ``a`b"]) {
			expect(holdBackUnclosedInline(text, text.length)).toBe(text.indexOf(" ") + 1);
		}
		for (const text of ["Value $x + y$", "Value $$x + y$$", "Use ``a`b``", "Cost \\$5", "Use `[$x]` now"]) {
			expect(holdBackUnclosedInline(text, text.length)).toBe(text.length);
		}
	});

	test("keeps nested link destinations and a just-arrived closing bracket pending", () => {
		for (const text of [
			"See [page]",
			"See [page](https://example.test/a(b)",
			"See ![image](https://example.test/a(b)",
		]) {
			expect(holdBackUnclosedInline(text, text.length)).toBe(4);
		}
		const text = "See [page](https://example.test/a(b)) now";
		expect(holdBackUnclosedInline(text, text.length)).toBe(text.length);
	});
	test("holds an open link until its url closes", () => {
		const text = "See [report](/tmp/report.md) now";
		expect(holdBackUnclosedInline(text, "See [rep".length)).toBe("See ".length);
		expect(holdBackUnclosedInline(text, "See [report](/tmp/re".length)).toBe("See ".length);
		expect(holdBackUnclosedInline(text, "See [report](/tmp/report.md)".length)).toBe(
			"See [report](/tmp/report.md)".length,
		);
	});

	test("brackets that are not followed by a url are not a link", () => {
		const text = "array[0] is fine";
		expect(holdBackUnclosedInline(text, text.length)).toBe(text.length);
	});

	test("holds open inline code and bold", () => {
		expect(holdBackUnclosedInline("run `npm te", "run `npm te".length)).toBe("run ".length);
		expect(holdBackUnclosedInline("run `npm test` now", "run `npm test` now".length)).toBe(
			"run `npm test` now".length,
		);
		expect(holdBackUnclosedInline("a **bold wo", "a **bold wo".length)).toBe("a ".length);
		expect(holdBackUnclosedInline("a **bold** b", "a **bold** b".length)).toBe("a **bold** b".length);
	});

	test("only looks at the current line", () => {
		const text = "[broken\nnext line";
		expect(holdBackUnclosedInline(text, text.length)).toBe(text.length);
	});
});

describe("planReveal", () => {
	const base = { final: false, ratePerMs: 0.1, elapsedMs: 100, stalled: false, heldMs: 0 };

	test("reveals an already complete inline construct atomically even when its closing token exceeds the character budget", () => {
		for (const text of [
			"See [page](https://example.test/a(b))",
			"See $x + y$",
			"See **bold words**",
			"See ``a`b``",
		]) {
			expect(planReveal({ ...base, text, revealed: 4, ratePerMs: 0.02 })?.end).toBe(text.length);
		}
	});

	test("does not use an unrelated next line as an inline closing delimiter", () => {
		expect(planReveal({ ...base, text: "See [broken\nNext paragraph", revealed: 4, ratePerMs: 0.02 })).toEqual({
			end: 4,
			held: true,
		});
	});

	test("returns null when everything is already shown", () => {
		expect(planReveal({ ...base, text: "done", revealed: 4 })).toBeNull();
	});

	test("reveals a rate-sized slice aligned to a word boundary", () => {
		// 0.1 字/ms × 100ms × 1.15 ≈ 12 字，落在 "sentence" 中间，向后推到词尾。
		const text = "A short sentence that keeps going on and on";
		expect(planReveal({ ...base, text, revealed: 0 })?.end).toBe("A short sentence".length);
	});

	test("keeps an unfinished trailing word until it completes or the stream stalls", () => {
		const text = "Hello there, gene";
		expect(planReveal({ ...base, text, revealed: 0, ratePerMs: 1 })?.end).toBe("Hello there, ".length);
		expect(planReveal({ ...base, text, revealed: 0, ratePerMs: 1, stalled: true })?.end).toBe(text.length);
		expect(planReveal({ ...base, text, revealed: 0, ratePerMs: 1, final: true })?.end).toBe(text.length);
	});

	test("catches up when the backlog exceeds the allowed lag and snaps when it is huge", () => {
		const text = "word ".repeat(100);
		const slow = planReveal({ ...base, text, revealed: 0, ratePerMs: 0.02 });
		expect(slow?.end).toBeGreaterThan(0.02 * 100 * 1.15 + 5);
		const huge = planReveal({ ...base, text: "x ".repeat(1000), revealed: 0 });
		expect(huge?.end).toBe(2000);
	});

	test("reveals everything at once when the stream is final, ignoring holds", () => {
		const text = `${"a ".repeat(100)}[open](/tmp/li`;
		const step = planReveal({ ...base, text, revealed: 0, final: true, ratePerMs: 0.01, elapsedMs: 1 });
		expect(step).toEqual({ end: text.length, held: false });
	});

	test("holds back an open link and reports it, then releases after the hold timeout", () => {
		const text = "See [report](/tmp/rep";
		const held = planReveal({ ...base, text, revealed: 0, ratePerMs: 1 });
		expect(held).toEqual({ end: "See ".length, held: true });
		const waiting = planReveal({ ...base, text, revealed: "See ".length, ratePerMs: 1 });
		expect(waiting).toEqual({ end: "See ".length, held: true });
		const released = planReveal({ ...base, text, revealed: "See ".length, ratePerMs: 1, heldMs: HOLD_MAX_MS });
		expect(released?.held).toBe(false);
		expect(released?.end).toBeGreaterThan("See ".length);
	});
});

describe("TeX delimiter streaming", () => {
	test.each([String.raw`before \(x^2`, String.raw`before \[x^2`])("holds unclosed formula %s", (text) => {
		expect(holdBackUnclosedInline(text, text.length)).toBe(7);
	});
	test.each([String.raw`before \(x^2\) after`, String.raw`before \[x^2\] after`, String.raw`before \\(literal`])(
		"releases complete or escaped formula %s",
		(text) => {
			expect(holdBackUnclosedInline(text, text.length)).toBe(text.length);
		},
	);
});
