import { describe, expect, test } from "vitest";
import { nextPhraseEnd, planReveal, splitStreamingSegments } from "./streaming-reveal";

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

describe("planReveal", () => {
	test("returns null when only an unfinished tail is available", () => {
		expect(planReveal("Hello there, gene", "Hello there,".length, false)).toBeNull();
	});

	test("reveals one phrase at a time", () => {
		expect(planReveal("One, two, three, four", 0, false)?.end).toBe("One,".length);
	});

	test("waits longer as the backlog drains", () => {
		const text = "a, b, c, d, e, f, g, h, i, ";
		const busy = planReveal(text, 0, false);
		const nearlyDone = planReveal(text, text.indexOf("h,"), false);
		expect(busy?.delayMs).toBe(50);
		expect(nearlyDone?.delayMs).toBeGreaterThan(busy?.delayMs ?? 0);
		expect(planReveal("last one.", 0, true)?.delayMs).toBe(300);
	});

	test("reveals several phrases per step for a very large backlog", () => {
		const text = "phrase, ".repeat(60);
		const step = planReveal(text, 0, false);
		expect(step?.end).toBeGreaterThan("phrase,".length);
	});
});
