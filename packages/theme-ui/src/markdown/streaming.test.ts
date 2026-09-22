import { describe, expect, test } from "vitest";
import type { HastElement, HastRoot, HastText } from "./nodes";
import { rehypeStreamingChunks } from "./streaming";

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
