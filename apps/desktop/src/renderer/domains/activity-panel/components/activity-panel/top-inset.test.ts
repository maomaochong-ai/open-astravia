import { describe, expect, it } from "vitest";
import { MAC_MAXIMIZED_TOP_INSET, resolveActivityPanelTopInset } from "./top-inset";

describe("resolveActivityPanelTopInset", () => {
	// macOS 铺满时红绿灯是系统绘制的、不占布局：顶栏必须让出一个按钮高度，
	// 否则页签与面板上分割线正好压在圆点下方（实测细微重叠）。
	it("macOS 铺满时让出红绿灯高度", () => {
		expect(resolveActivityPanelTopInset({ isMac: true, isMaximized: true })).toBe(MAC_MAXIMIZED_TOP_INSET);
	});

	// Windows / Linux 没有浮在内容上的窗口按钮：多给内边距就是「页签离屏幕顶一条空带」。
	it("Windows / Linux 铺满时贴到窗口顶", () => {
		expect(resolveActivityPanelTopInset({ isMac: false, isMaximized: true })).toBe(0);
	});

	it("非铺满时不需要让位", () => {
		expect(resolveActivityPanelTopInset({ isMac: true, isMaximized: false })).toBe(0);
		expect(resolveActivityPanelTopInset({ isMac: false, isMaximized: false })).toBe(0);
	});
});
