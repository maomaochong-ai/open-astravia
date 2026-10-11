import { describe, expect, it } from "vitest";
import { rehypeKeepPairedPunctuation } from "./em-dash";
import type { HastRoot, HastText } from "./nodes";

function run(value: string): string {
	const tree: HastRoot = { type: "root", children: [{ type: "text", value }] };
	rehypeKeepPairedPunctuation()(tree);
	return tree.children.map((child) => (child.type === "text" ? child.value : "")).join("");
}

describe("rehypeKeepPairedPunctuation", () => {
	it("joins a paired Chinese em dash so Chromium cannot break between the two dashes", () => {
		expect(run("多了什么——它是不是")).toBe("多了什么—\u2060—它是不是");
	});

	it("joins a paired ellipsis so Chromium cannot break between the two ellipses", () => {
		expect(run("多了什么……它是不是")).toBe("多了什么…\u2060…它是不是");
	});

	it("joins every adjacent pair in longer runs", () => {
		expect(run("———")).toBe("—\u2060—\u2060—");
	});

	it("leaves a lone em dash untouched", () => {
		expect(run("a—b")).toBe("a—b");
	});

	it("leaves a lone ellipsis untouched", () => {
		expect(run("a…b")).toBe("a…b");
	});

	it("leaves code blocks literal", () => {
		const tree: HastRoot = {
			type: "root",
			children: [{ type: "element", tagName: "pre", children: [{ type: "text", value: "x——y……z" }] }],
		};
		rehypeKeepPairedPunctuation()(tree);
		const pre = tree.children[0];
		expect(pre.type === "element" && (pre.children[0] as HastText).value).toBe("x——y……z");
	});
});
