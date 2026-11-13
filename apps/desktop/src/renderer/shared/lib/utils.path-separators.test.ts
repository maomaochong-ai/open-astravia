import { describe, expect, it } from "vitest";
import { alignPathSeparators, pathDirname, pathJoin } from "./utils";

/**
 * 文件树的缓存键与 expandedDirs 都来自主进程 readDir 的原始返回值：
 * Windows 上是反斜杠。而对话里的交付物链接、插件传进来的路径通常用正斜杠。
 * 这组用例钉住「两种写法最终落到同一组键」。
 */
describe("alignPathSeparators", () => {
	it("根目录是 Windows 写法时，正斜杠路径转成反斜杠", () => {
		expect(alignPathSeparators("C:/ws/src/main.ts", "C:\\ws")).toBe("C:\\ws\\src\\main.ts");
	});

	it("根目录是 POSIX 写法时，反斜杠路径转成正斜杠", () => {
		expect(alignPathSeparators("/ws/src/main.ts", "/ws")).toBe("/ws/src/main.ts");
	});

	it("对齐之后的父目录与 pathJoin 仍保持一致写法", () => {
		const aligned = alignPathSeparators("C:/ws/src/main.ts", "C:\\ws");
		expect(pathDirname(aligned)).toBe("C:\\ws\\src");
		expect(pathJoin(pathDirname(aligned), "other.ts")).toBe("C:\\ws\\src\\other.ts");
	});

	it("空路径原样返回，不制造 '/' 之类的噪声", () => {
		expect(alignPathSeparators("", "C:\\ws")).toBe("");
		expect(alignPathSeparators("/ws/a.ts", "")).toBe("/ws/a.ts");
	});
});
