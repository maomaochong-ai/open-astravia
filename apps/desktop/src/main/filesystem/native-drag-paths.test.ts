import { describe, expect, it } from "vitest";
import { MAX_NATIVE_DRAG_ITEMS, normalizeNativeDragPaths } from "./native-drag-paths";

/**
 * 拖拽不该受「文件搬运计划」的 100 项上限约束：一次拖出一个目录、
 * 或一次选中上百个文件都是正常操作，超限抛错会让整次拖拽被静默取消。
 */
describe("原生拖拽的路径准备", () => {
	it("允许超过 100 项（原上限会在这里抛错，表现为「拖不动」）", () => {
		const paths = Array.from({ length: 250 }, (_, i) => `/ws/dir/f${i}.ts`);
		expect(normalizeNativeDragPaths(paths)).toHaveLength(250);
	});

	it("去重后保持首次出现顺序", () => {
		expect(normalizeNativeDragPaths(["/ws/b.ts", "/ws/a.ts", "/ws/b.ts"])).toEqual(["/ws/b.ts", "/ws/a.ts"]);
	});

	it("相对路径被拒绝", () => {
		expect(() => normalizeNativeDragPaths(["relative/path.ts"])).toThrow("Invalid paths");
	});

	it("空列表与非数组被拒绝，不做静默放过", () => {
		expect(() => normalizeNativeDragPaths([])).toThrow("Invalid paths");
		expect(() => normalizeNativeDragPaths("not-an-array")).toThrow("Invalid paths");
	});

	it("病态输入仍然有上限，并说明是上限问题", () => {
		const paths = Array.from({ length: MAX_NATIVE_DRAG_ITEMS + 1 }, (_, i) => `/ws/f${i}.ts`);
		expect(() => normalizeNativeDragPaths(paths)).toThrow(/exceeds the drag limit/);
	});
});
