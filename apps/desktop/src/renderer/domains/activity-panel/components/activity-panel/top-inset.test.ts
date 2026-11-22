import { describe, expect, it } from "vitest";
import { MAC_MAXIMIZED_TOP_INSET, resolveActivityPanelTopInset } from "./top-inset";

describe("resolveActivityPanelTopInset", () => {
	/*
	 * macOS 铺满时红绿灯是系统绘制的、不占布局。它们与页签的冲突靠**横向**让位解决：
	 * 调用方在这一状态下给顶栏 `pl-[78px]`，整排页签从圆点右侧开始。
	 * 纵向再让整整一个标题栏高度就会变成「标签页离屏幕顶一条空带」，所以只留呼吸位。
	 */
	it("macOS 铺满时只留呼吸位，不再让出整个标题栏高度", () => {
		expect(resolveActivityPanelTopInset({ isMac: true, isMaximized: true })).toBe(MAC_MAXIMIZED_TOP_INSET);
		// 上限必须远小于标题栏高度（macOS 约 28px），否则页签会被推下去一大截。
		expect(MAC_MAXIMIZED_TOP_INSET).toBeLessThan(12);
	});

	// Windows / Linux 默认标题栏由应用绘制：多给内边距就是「页签离屏幕顶一条空带」。
	it("Windows / Linux 铺满时贴到窗口顶", () => {
		expect(resolveActivityPanelTopInset({ isMac: false, isMaximized: true })).toBe(0);
	});

	it("非铺满时不需要让位", () => {
		expect(resolveActivityPanelTopInset({ isMac: true, isMaximized: false })).toBe(0);
		expect(resolveActivityPanelTopInset({ isMac: false, isMaximized: false })).toBe(0);
	});
});
