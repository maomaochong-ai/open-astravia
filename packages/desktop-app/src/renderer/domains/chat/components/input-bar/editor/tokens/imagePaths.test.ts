import { describe, expect, it } from "vitest";
import { stableImagePaths } from "./imagePaths";

describe("stableImagePaths", () => {
	it("内容不变时保持同一引用，避免逐字符重渲染", () => {
		const first = stableImagePaths(["/a/1.png", "/a/2.png"]);
		const second = stableImagePaths(["/a/1.png", "/a/2.png"]);
		expect(second).toBe(first);
	});

	it("顺序或成员变化时返回新引用", () => {
		const base = stableImagePaths(["/a/1.png", "/a/2.png"]);
		expect(stableImagePaths(["/a/2.png", "/a/1.png"])).not.toBe(base);
		expect(stableImagePaths(["/a/2.png", "/a/1.png", "/a/3.png"])).toEqual(["/a/2.png", "/a/1.png", "/a/3.png"]);
	});
});
