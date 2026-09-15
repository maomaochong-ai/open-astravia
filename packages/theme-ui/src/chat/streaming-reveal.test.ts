import { describe, expect, test } from "vitest";
import { nextRevealEnd, splitStreamingSegments } from "./streaming-reveal";

describe("nextRevealEnd", () => {
	test("reveals at least one character per frame while behind", () => {
		expect(nextRevealEnd("hello", 0, 0)).toBe(1);
	});

	test("never overshoots the target", () => {
		expect(nextRevealEnd("hello", 3, 10_000)).toBe(5);
		expect(nextRevealEnd("hello", 5, 32)).toBe(5);
		expect(nextRevealEnd("hi", 9, 32)).toBe(2);
	});

	test("reveals a large backlog progressively instead of all at once", () => {
		const text = "x".repeat(2000);
		const first = nextRevealEnd(text, 0, 32);
		expect(first).toBeGreaterThan(1);
		expect(first).toBeLessThan(text.length / 4);
	});

	test("drains any backlog within a bounded number of frames", () => {
		const text = "x".repeat(5000);
		let revealed = 0;
		let frames = 0;
		while (revealed < text.length && frames < 1000) {
			revealed = nextRevealEnd(text, revealed, 32);
			frames++;
		}
		expect(revealed).toBe(text.length);
		// 最低速度兜底：尾巴不会无限拖长。
		expect(frames * 32).toBeLessThan(3000);
	});

	test("does not split a surrogate pair", () => {
		const text = "a😀b";
		expect(nextRevealEnd(text, 1, 0)).toBe(3);
	});
});

describe("splitStreamingSegments", () => {
	test("round-trips the source text", () => {
		const text = "Hello, world! 你好世界，这是流式输出。\n  indented";
		expect(splitStreamingSegments(text).join("")).toBe(text);
	});

	test("splits latin text by word and keeps whitespace as its own segment", () => {
		expect(splitStreamingSegments("fade in smoothly")).toEqual(["fade", " ", "in", " ", "smoothly"]);
	});

	test("splits CJK text into multiple segments rather than one block", () => {
		expect(splitStreamingSegments("今天天气很好我们出去散步").length).toBeGreaterThan(1);
	});
});
