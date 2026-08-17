import { describe, expect, test } from "vitest";
import {
	anchorLineHash,
	parseAnchor,
	renderAnchoredLines,
	renderAnchorRegion,
	validateAnchor,
} from "../../../src/coding/shared/anchors.js";

describe("anchorLineHash", () => {
	test("4 base36 chars, whitespace-insensitive", () => {
		const h = anchorLineHash("const x = 1;");
		expect(h).toMatch(/^[0-9a-z]{4}$/);
		expect(anchorLineHash("  const x = 1;  ")).toBe(h);
		expect(anchorLineHash("const\tx =  1;")).toBe(h);
		expect(anchorLineHash("const y = 1;")).not.toBe(h);
	});
});

describe("parseAnchor", () => {
	test("parses line:hash", () => {
		expect(parseAnchor("42:ab")).toEqual({ line: 42, hash: "ab" });
	});
	test("tolerates a full anchored line pasted in (strips → and content)", () => {
		expect(parseAnchor("42:ab→const x = 1;")).toEqual({ line: 42, hash: "ab" });
	});
	test("accepts 2..8 char hashes (tolerates legacy 2-char and wider)", () => {
		expect(parseAnchor("42:abcd")).toEqual({ line: 42, hash: "abcd" });
		expect(parseAnchor("42:ab")).toEqual({ line: 42, hash: "ab" });
	});
	test("rejects malformed anchors", () => {
		expect(parseAnchor("42")).toBeUndefined();
		expect(parseAnchor("ab:42")).toBeUndefined();
		expect(parseAnchor("0:ab")).toBeUndefined();
		expect(parseAnchor("42:a")).toBeUndefined();
		expect(parseAnchor("42:abcdefghi")).toBeUndefined();
		expect(parseAnchor("")).toBeUndefined();
	});
});

describe("validateAnchor", () => {
	const lines = ["alpha", "beta", "gamma", "delta", "epsilon"];
	const anchorFor = (line: number) => ({ line, hash: anchorLineHash(lines[line - 1]) });

	test("ok when line and hash match", () => {
		expect(validateAnchor(lines, anchorFor(3))).toEqual({ status: "ok", line: 3 });
	});

	test("shifted: hash found within radius when line moved", () => {
		// 声称在第 1 行，内容其实在第 3 行
		const anchor = { line: 1, hash: anchorLineHash("gamma") };
		expect(validateAnchor(lines, anchor)).toEqual({ status: "shifted", line: 3 });
	});

	test("stale when hash not found within radius", () => {
		const anchor = { line: 2, hash: anchorLineHash("nonexistent-content") };
		expect(validateAnchor(lines, anchor)).toEqual({ status: "stale" });
	});

	test("stale when shift exceeds radius", () => {
		const many = Array.from({ length: 100 }, (_, i) => `line-${i}`);
		many[99] = "target";
		const anchor = { line: 1, hash: anchorLineHash("target") };
		expect(validateAnchor(many, anchor, 20)).toEqual({ status: "stale" });
	});

	test("ambiguous drift → stale: multiple identical lines within radius, none猜取", () => {
		// 空行/重复 `}` 是真实代码常态；漂移锚点落到它们身上时不得静默取最近者。
		const dup = ["", "code1", "", "code2", ""];
		const blank = anchorLineHash("");
		// 行号提示漂移（claim 2，实际空行在 1/3/5），半径内有 3 个同哈希候选 → stale
		expect(validateAnchor(dup, { line: 2, hash: blank })).toEqual({ status: "stale" });
	});

	test("exact line+hash still ok even when duplicates exist elsewhere", () => {
		// 行号精确命中是权威好路径：模型逐字复制的锚点必须照常生效。
		const dup = ["", "code1", "", "code2", ""];
		const blank = anchorLineHash("");
		expect(validateAnchor(dup, { line: 3, hash: blank })).toEqual({ status: "ok", line: 3 });
	});

	test("unique drift target still recovers as shifted", () => {
		const anchor = { line: 1, hash: anchorLineHash("gamma") };
		expect(validateAnchor(lines, anchor)).toEqual({ status: "shifted", line: 3 });
	});
});

describe("renderAnchoredLines / renderAnchorRegion", () => {
	test("prefixes each line with its anchor", () => {
		const rendered = renderAnchoredLines(["a", "b"], 10);
		expect(rendered[0]).toBe(`10:${anchorLineHash("a")}→a`);
		expect(rendered[1]).toBe(`11:${anchorLineHash("b")}→b`);
	});

	test("region clamps to file bounds", () => {
		const lines = ["a", "b", "c"];
		const region = renderAnchorRegion(lines, 1, 3);
		expect(region.split("\n")).toHaveLength(3);
		expect(region.startsWith(`1:${anchorLineHash("a")}→a`)).toBe(true);
	});
});
