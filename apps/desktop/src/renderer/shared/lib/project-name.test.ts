import { describe, expect, it } from "vitest";
import { isDuplicateProjectName, normalizeProjectName } from "./project-name";

describe("normalizeProjectName", () => {
	it("去掉首尾空白并统一大小写", () => {
		expect(normalizeProjectName("  Alpha ")).toBe("alpha");
	});
});

describe("isDuplicateProjectName", () => {
	it("忽略大小写与首尾空白判定重名", () => {
		expect(isDuplicateProjectName(" alpha ", ["Alpha", "Beta"])).toBe(true);
	});

	it("名字不同则放行", () => {
		expect(isDuplicateProjectName("Gamma", ["Alpha", "Beta"])).toBe(false);
	});

	it("空名字交给对话框自己的必填校验，不在这里报重名", () => {
		expect(isDuplicateProjectName("   ", ["Alpha"])).toBe(false);
	});
});
