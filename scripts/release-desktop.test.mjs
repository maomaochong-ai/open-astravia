import { describe, expect, it } from "vitest";
import { bumpVersion, parsePorcelainPaths } from "./release-desktop.mjs";

describe("parsePorcelainPaths", () => {
	// 回归：曾经对整段输出做 trim，削掉第一行的前导空格后 slice(3) 吃掉路径首字母，
	// 于是第一个改动文件永远匹配不上发布白名单（"apps/..." 被读成 "pps/..."）。
	it("keeps the leading path character of the first unstaged entry", () => {
		const stdout = " M apps/desktop/CHANGELOG.md\n M apps/desktop/package.json\n M bun.lock\n";
		expect(parsePorcelainPaths(stdout)).toEqual([
			"apps/desktop/CHANGELOG.md",
			"apps/desktop/package.json",
			"bun.lock",
		]);
	});

	it("parses staged, unstaged and untracked prefixes alike", () => {
		const stdout = "M  apps/desktop/package.json\n?? scratch.txt\nMM bun.lock\n";
		expect(parsePorcelainPaths(stdout)).toEqual([
			"apps/desktop/package.json",
			"scratch.txt",
			"bun.lock",
		]);
	});

	it("returns nothing for a clean worktree", () => {
		expect(parsePorcelainPaths("")).toEqual([]);
		expect(parsePorcelainPaths("\n")).toEqual([]);
	});

	it("normalizes Windows separators", () => {
		expect(parsePorcelainPaths(" M apps\\desktop\\package.json\n")).toEqual([
			"apps/desktop/package.json",
		]);
	});
});

describe("bumpVersion", () => {
	it("bumps patch and minor", () => {
		expect(bumpVersion("0.5.47", "patch")).toBe("0.5.48");
		expect(bumpVersion("0.5.47", "minor")).toBe("0.6.0");
	});

	it("rejects a non-semver desktop version", () => {
		expect(() => bumpVersion("0.5", "patch")).toThrow(/Invalid desktop version/);
	});
});
