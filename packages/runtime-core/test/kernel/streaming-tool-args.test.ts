import { describe, expect, it } from "vitest";
import { settledToolArgs } from "../../src/kernel/streaming-tool-args.js";

describe("settledToolArgs", () => {
	it("withholds the key still being streamed", () => {
		// `path` 已完整、`newText` 还在一段段变长：只播报 path。
		expect(settledToolArgs({ path: "a.tsx", newText: "partial so" }, 0)).toEqual({
			args: { path: "a.tsx" },
			keyCount: 1,
		});
	});

	it("says nothing until a key is settled", () => {
		// 只有一个键时它就是「正在生成的那个」，值还不可信。
		expect(settledToolArgs({ path: "a.ts" }, 0)).toBeNull();
		expect(settledToolArgs({}, 0)).toBeNull();
	});

	it("only fires when the settled key count grows", () => {
		// 同一批键反复解析（每个 delta 一次）不该反复播报。
		expect(settledToolArgs({ path: "a.tsx", newText: "more text" }, 1)).toBeNull();
		expect(settledToolArgs({ path: "a.tsx", oldText: "x", newText: "y" }, 1)).toEqual({
			args: { path: "a.tsx", oldText: "x" },
			keyCount: 2,
		});
	});

	it("ignores anything that is not a plain object", () => {
		expect(settledToolArgs(null, 0)).toBeNull();
		expect(settledToolArgs("path", 0)).toBeNull();
		expect(settledToolArgs(["a", "b"], 0)).toBeNull();
		expect(settledToolArgs(undefined, 0)).toBeNull();
	});
});
