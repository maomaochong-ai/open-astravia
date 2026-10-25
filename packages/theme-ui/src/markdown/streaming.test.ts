import { describe, expect, test } from "vitest";
import type { HastElement, HastRoot, HastText } from "./nodes";
import {
	rehypeStreamingChunks,
	resolveStreamRenderInterval,
	STREAM_ANIMATE_MAX_CHARS,
	shouldRevealStreamingTail,
} from "./streaming";

function text(value: string): HastText {
	return { type: "text", value } as HastText;
}

function paragraph(...children: Array<HastText | HastElement>): HastElement {
	return { type: "element", tagName: "p", properties: {}, children } as HastElement;
}

function chunkClasses(root: HastRoot): string[][] {
	const out: string[][] = [];
	const walk = (node: HastRoot | HastElement): void => {
		for (const child of node.children) {
			if (child.type !== "element") continue;
			const className = (child.properties?.className as string[] | undefined) ?? [];
			if (className.includes("streaming-chunk")) out.push(className);
			walk(child);
		}
	};
	walk(root);
	return out;
}

describe("rehypeStreamingChunks", () => {
	test("marks only the newest two phrases so brightness follows the reveal cadence without animation", () => {
		const tree = { type: "root", children: [paragraph(text("One, two, three, four."))] } as HastRoot;
		rehypeStreamingChunks()(tree);
		expect(chunkClasses(tree)).toEqual([
			["streaming-chunk"],
			["streaming-chunk"],
			["streaming-chunk", "streaming-chunk-recent"],
			["streaming-chunk", "streaming-chunk-latest"],
		]);
	});

	test("a single phrase is the latest one and there is no recent phrase", () => {
		const tree = { type: "root", children: [paragraph(text("Hello."))] } as HastRoot;
		rehypeStreamingChunks()(tree);
		expect(chunkClasses(tree)).toEqual([["streaming-chunk", "streaming-chunk-latest"]]);
	});

	test("the newest phrase is found across block boundaries", () => {
		const tree = {
			type: "root",
			children: [paragraph(text("First, second.")), paragraph(text("Third."))],
		} as HastRoot;
		rehypeStreamingChunks()(tree);
		expect(chunkClasses(tree)).toEqual([
			["streaming-chunk"],
			["streaming-chunk", "streaming-chunk-recent"],
			["streaming-chunk", "streaming-chunk-latest"],
		]);
	});
});

describe("shouldRevealStreamingTail", () => {
	test("a streaming tail inside the limit still animates", () => {
		expect(shouldRevealStreamingTail("short reply", true)).toBe(true);
		expect(shouldRevealStreamingTail("x".repeat(STREAM_ANIMATE_MAX_CHARS), true)).toBe(true);
	});

	// 压缩摘要能到 20k–72k 字符；逐字 reveal 会把整篇 markdown 每 100ms 重解析一次，
	// 长摘要压缩卡片在这条路径上会抛 React #185。超过上限就必须直接给全文。
	test("a long streaming tail skips reveal instead of re-parsing the whole document every tick", () => {
		expect(shouldRevealStreamingTail("x".repeat(STREAM_ANIMATE_MAX_CHARS + 1), true)).toBe(false);
		expect(shouldRevealStreamingTail("x".repeat(72_767), true)).toBe(false);
	});

	test("a settled block never animates, whatever its length", () => {
		expect(shouldRevealStreamingTail("short reply", false)).toBe(false);
		expect(shouldRevealStreamingTail("x".repeat(STREAM_ANIMATE_MAX_CHARS + 1), false)).toBe(false);
	});
});

describe("resolveStreamRenderInterval", () => {
	test("short replies keep rendering immediately", () => {
		expect(resolveStreamRenderInterval(300, 300)).toBe(0);
		expect(resolveStreamRenderInterval(11_999, 11_999)).toBe(0);
	});

	test("a large tail alone still raises the interval", () => {
		expect(resolveStreamRenderInterval(5_000, 12_000)).toBe(200);
		expect(resolveStreamRenderInterval(5_000, 50_000)).toBe(400);
	});

	// 尾块在每个新空行处归零，只按它算会让间隔在每个新段落回落成 0，
	// 长文本流式期间于是反复全量解析——这正是 #185 需要的压力。
	test("the interval does not fall back to zero when a new paragraph resets the tail", () => {
		expect(resolveStreamRenderInterval(13_000, 200)).toBe(200);
		expect(resolveStreamRenderInterval(13_180, 80)).toBe(200);
		expect(resolveStreamRenderInterval(52_400, 120)).toBe(400);
	});

	test("the interval only grows as the stream grows", () => {
		const lengths = [8_000, 12_000, 12_400, 30_000, 49_999, 50_000, 60_000];
		const intervals = lengths.map((length) => resolveStreamRenderInterval(length, 40));
		expect(intervals).toEqual([0, 200, 200, 200, 200, 400, 400]);
	});
});
