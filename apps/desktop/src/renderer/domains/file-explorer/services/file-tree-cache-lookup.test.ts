import type { FsEntry } from "@shared/store/atoms";
import { describe, expect, it } from "vitest";
import { findCachedEntries, findCachedEntry } from "./file-tree-cache-lookup";

function entry(path: string): FsEntry {
	return { name: path.split(/[\\/]/).pop() ?? path, path, isDirectory: false, size: 1, modifiedAt: 0 };
}

/** 主进程 readDir 返回的是 Windows 原生分隔符，缓存键因此是反斜杠。 */
function windowsCache(): Map<string, readonly FsEntry[]> {
	return new Map([
		["C:\\ws", [entry("C:\\ws\\src"), entry("C:\\ws\\readme.md")]],
		["C:\\ws\\src", [entry("C:\\ws\\src\\main.ts")]],
	]);
}

describe("文件树缓存查找的路径分隔符", () => {
	it("Windows 缓存键为反斜杠时，正斜杠的路径也能命中", () => {
		const cache = windowsCache();
		expect(findCachedEntry(cache, "C:/ws/src/main.ts")?.path).toBe("C:\\ws\\src\\main.ts");
		expect(findCachedEntry(cache, "C:/ws/readme.md")?.path).toBe("C:\\ws\\readme.md");
	});

	it("反斜杠路径查正斜杠缓存同样命中（反方向也要成立）", () => {
		const cache = new Map<string, readonly FsEntry[]>([["/ws/src", [entry("/ws/src/main.ts")]]]);
		expect(findCachedEntry(cache, "\\ws\\src\\main.ts")?.path).toBe("/ws/src/main.ts");
	});

	it("混合分隔符的批量查找保持输入顺序，只返回命中的项", () => {
		const found = findCachedEntries(windowsCache(), ["C:/ws/src", "C:\\ws\\src\\main.ts", "C:/ws/nope.ts"]);
		expect(found.map((e) => e.path)).toEqual(["C:\\ws\\src", "C:\\ws\\src\\main.ts"]);
	});

	it("大小写差异不当作同一路径（Windows 上由主进程 resolve 负责规范化）", () => {
		expect(findCachedEntry(windowsCache(), "c:/ws/readme.md")).toBeUndefined();
	});
});
