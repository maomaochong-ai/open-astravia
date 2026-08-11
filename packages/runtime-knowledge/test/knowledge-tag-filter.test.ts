import { describe, expect, it } from "vitest";
import { filterByTags, type TaggedPage } from "../src/index.js";

const pages: TaggedPage[] = [
	{ id: "1", tags: ["a", "b"] },
	{ id: "2", tags: ["b", "c"] },
	{ id: "3", tags: ["c"] },
	{ id: "4", tags: [] },
];

describe("filterByTags", () => {
	it("空查询 → 返回全部（保持顺序）", () => {
		expect(filterByTags(pages, {})).toEqual(["1", "2", "3", "4"]);
	});

	it("all = 交：必须同时含全部", () => {
		expect(filterByTags(pages, { all: ["a", "b"] })).toEqual(["1"]);
		expect(filterByTags(pages, { all: ["b"] })).toEqual(["1", "2"]);
		expect(filterByTags(pages, { all: ["a", "c"] })).toEqual([]);
	});

	it("any = 并：含其一即可", () => {
		expect(filterByTags(pages, { any: ["a", "c"] })).toEqual(["1", "2", "3"]);
		expect(filterByTags(pages, { any: ["z"] })).toEqual([]);
	});

	it("none = 补：不含任何，相对全库", () => {
		expect(filterByTags(pages, { none: ["c"] })).toEqual(["1", "4"]);
		expect(filterByTags(pages, { none: ["a", "b", "c"] })).toEqual(["4"]);
	});

	it("三者组合 AND", () => {
		// 含 b，且不含 a → 只剩 2
		expect(filterByTags(pages, { all: ["b"], none: ["a"] })).toEqual(["2"]);
		// 含 b 或 c，且不含 a
		expect(filterByTags(pages, { any: ["b", "c"], none: ["a"] })).toEqual(["2", "3"]);
	});

	it("空集页：只有 none 或空查询能命中", () => {
		expect(filterByTags([{ id: "x", tags: [] }], { all: ["a"] })).toEqual([]);
		expect(filterByTags([{ id: "x", tags: [] }], { none: ["a"] })).toEqual(["x"]);
	});

	it("重叠标签不重复计入", () => {
		expect(filterByTags([{ id: "x", tags: ["a", "a"] }], { all: ["a"] })).toEqual(["x"]);
	});
});
