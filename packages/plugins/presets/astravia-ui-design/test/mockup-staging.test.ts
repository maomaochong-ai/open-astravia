import { describe, expect, it } from "vitest";
import { attachFrame, detachFrame, railFrames, swapFrames } from "../src/mockup/attach";
import { paginate } from "../src/mockup/paginate";

describe("mockup staging", () => {
	it("appends attached frames in click order", () => {
		expect(attachFrame(attachFrame([], "a"), "b")).toEqual(["a", "b"]);
	});

	it("inserts at the drop position", () => {
		expect(attachFrame(["a", "b"], "c", 1)).toEqual(["a", "c", "b"]);
		// 落点越界（拖到末尾之外）按末尾算，而不是丢掉这次拖拽。
		expect(attachFrame(["a", "b"], "c", 9)).toEqual(["a", "b", "c"]);
	});

	// 同一个画框进两次会在导出图里重复一格，而左侧列表已经把它藏起来了——
	// 用户根本无从发现是哪一步出的问题。
	it("never stages the same frame twice", () => {
		expect(attachFrame(["a", "b"], "a", 0)).toEqual(["a", "b"]);
	});

	it("detaches by id", () => {
		expect(detachFrame(["a", "b", "c"], "b")).toEqual(["a", "c"]);
		expect(detachFrame(["a"], "zz")).toEqual(["a"]);
	});

	it("swaps two slots and ignores out-of-range drops", () => {
		expect(swapFrames(["a", "b", "c"], 0, 2)).toEqual(["c", "b", "a"]);
		expect(swapFrames(["a", "b"], 0, 5)).toEqual(["a", "b"]);
		expect(swapFrames(["a", "b"], 1, 1)).toEqual(["a", "b"]);
	});

	// 左侧缩略图列表就是「已加入」的补集：加入后必须消失，移除后必须回到原位。
	it("keeps the rail as the complement of the staged list, in canvas order", () => {
		const frames = [{ id: "a" }, { id: "b" }, { id: "c" }];
		expect(railFrames(frames, ["b"])).toEqual([{ id: "a" }, { id: "c" }]);
		expect(railFrames(frames, [])).toEqual(frames);
		expect(railFrames(frames, ["a", "b", "c"])).toEqual([]);
	});
});

describe("paginate", () => {
	it("splits the sequence into pages of the chosen size", () => {
		expect(paginate([1, 2, 3, 4, 5], 3)).toEqual([
			[1, 2, 3],
			[4, 5],
		]);
	});

	it("has no pages when nothing is staged", () => {
		expect(paginate([], 3)).toEqual([]);
	});

	it("never divides by a non-positive page size", () => {
		expect(paginate([1, 2], 0)).toEqual([[1], [2]]);
	});
});
