import type { FsEntry } from "@shared/store/atoms";
import { describe, expect, it } from "vitest";
import { findCachedEntries, findCachedEntry } from "./file-tree-cache-lookup";

function entry(path: string): FsEntry {
	return { name: path.split(/[/\\]/u).at(-1) ?? path, path, isDirectory: false, size: 0, modifiedAt: 0 };
}

describe("file tree cache lookup", () => {
	it("按父目录命中，不会把别的目录里的同名文件认成目标", () => {
		const cache = new Map<string, readonly FsEntry[]>([
			["/repo/src", [entry("/repo/src/a.ts")]],
			["/repo/lib", [entry("/repo/lib/a.ts")]],
		]);

		expect(findCachedEntry(cache, "/repo/lib/a.ts")?.path).toBe("/repo/lib/a.ts");
		expect(findCachedEntry(cache, "/repo/test/a.ts")).toBeUndefined();
	});

	it("未加载的目录直接查不到，不需要为已知路径预先展开", () => {
		const cache = new Map<string, readonly FsEntry[]>([["/repo", [entry("/repo/readme.md")]]]);
		expect(findCachedEntries(cache, ["/repo/readme.md", "/repo/missing.md"])).toHaveLength(1);
	});

	it("保持传入顺序，跳过重复与未命中的路径", () => {
		const cache = new Map<string, readonly FsEntry[]>([
			["/repo", [entry("/repo/b.ts"), entry("/repo/a.ts")]],
		]);

		expect(findCachedEntries(cache, ["/repo/a.ts", "/repo/b.ts"]).map((item) => item.path)).toEqual([
			"/repo/a.ts",
			"/repo/b.ts",
		]);
	});

	it("认得 Windows 反斜杠路径与盘符根", () => {
		const cache = new Map<string, readonly FsEntry[]>([
			["C:\\repo", [entry("C:\\repo\\a.ts")]],
			["C:\\", [entry("C:\\b.ts")]],
		]);

		expect(findCachedEntry(cache, "C:\\repo\\a.ts")?.path).toBe("C:\\repo\\a.ts");
		expect(findCachedEntry(cache, "C:\\b.ts")?.path).toBe("C:\\b.ts");
	});
});
