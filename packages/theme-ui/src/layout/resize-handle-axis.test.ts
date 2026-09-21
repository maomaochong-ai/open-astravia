import { describe, expect, it } from "vitest";
import { type ResizeHandleSide, resizeHandleDelta, resolveResizeHandleAxis } from "./ResizeHandle";

describe("resizeHandleDelta", () => {
	it("贴在结束边的把手：顺着指针方向拖就是变大", () => {
		expect(resizeHandleDelta("right", 12)).toBe(12);
		expect(resizeHandleDelta("bottom", 12)).toBe(12);
	});

	it("贴在起始边的把手：往回拖才是变大", () => {
		expect(resizeHandleDelta("left", 12)).toBe(-12);
		expect(resizeHandleDelta("top", 12)).toBe(-12);
		// 底部面板的把手贴在自己上沿：往上拖（负位移）应当把面板拉高。
		expect(resizeHandleDelta("top", -12)).toBe(12);
	});
});

describe("resolveResizeHandleAxis", () => {
	it("横向把手读 clientX，用列光标，轨道占满高度", () => {
		for (const side of ["left", "right"] satisfies ResizeHandleSide[]) {
			const axis = resolveResizeHandleAxis(side);
			expect(axis.vertical).toBe(false);
			expect(axis.cursorClass).toBe("cursor-col-resize");
			expect(axis.overlayCursor).toBe("col-resize");
			expect(axis.track).toContain("top-0");
		}
	});

	it("纵向把手读 clientY，用行光标，轨道占满宽度", () => {
		for (const side of ["top", "bottom"] satisfies ResizeHandleSide[]) {
			const axis = resolveResizeHandleAxis(side);
			expect(axis.vertical).toBe(true);
			expect(axis.cursorClass).toBe("cursor-row-resize");
			expect(axis.overlayCursor).toBe("row-resize");
			expect(axis.track).toContain("left-0");
			expect(axis.track).toContain("right-0");
		}
	});

	it("把手贴在 side 指定的那条边上", () => {
		expect(resolveResizeHandleAxis("left").edge).toBe("left-0");
		expect(resolveResizeHandleAxis("right").edge).toBe("right-0");
		expect(resolveResizeHandleAxis("top").edge).toBe("top-0");
		expect(resolveResizeHandleAxis("bottom").edge).toBe("bottom-0");
	});

	it("渐变方向跟着轴走，否则线条会在短边上被压没", () => {
		expect(resolveResizeHandleAxis("right").gradientDirection).toBe("to bottom");
		expect(resolveResizeHandleAxis("bottom").gradientDirection).toBe("to right");
	});
});
