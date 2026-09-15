/**
 * 探针结果是跨进程回来的 unknown：形状不对宁可当作「没量到」也不能把 NaN 带进
 * 视口尺寸；翻页脚本则必须先认帧、再滚动，滚完才亮就绪信号。
 */
import { expect, it } from "vitest";
import { FRAME_PAINTED_EXPRESSION } from "../src/canvas/offscreen-raster";
import {
	SCROLL_PROBE_SCRIPT,
	SCROLL_RESET_SCRIPT,
	parseScrollProbe,
	scrollPrepareScript,
	scrollReadyExpression,
} from "../src/materials/scroll-probe";

it("accepts a well-formed probe and clamps negative hidden space to zero", () => {
	expect(
		parseScrollProbe({ viewportWidth: 390, viewportHeight: 844, kind: "element", hidden: -3, top: 60, bottom: 760 }),
	).toEqual({ viewportWidth: 390, viewportHeight: 844, kind: "element", hidden: 0, top: 60, bottom: 760 });
});

it.each([
	["undefined (probe failed)", undefined],
	["missing kind", { viewportWidth: 390, viewportHeight: 844, hidden: 10, top: 0, bottom: 844 }],
	["non-finite height", { viewportWidth: 390, viewportHeight: Number.NaN, kind: "document", hidden: 10, top: 0, bottom: 1 }],
	["inverted visible band", { viewportWidth: 390, viewportHeight: 844, kind: "element", hidden: 10, top: 800, bottom: 700 }],
])("rejects %s", (_label, probe) => {
	expect(parseScrollProbe(probe)).toBeNull();
});

it("scripts are self-contained expressions that mark and reset the scroller", () => {
	expect(SCROLL_PROBE_SCRIPT).toContain("data-vetd-scroller");
	expect(SCROLL_RESET_SCRIPT).toContain("scrollTop = 0");
	expect(SCROLL_RESET_SCRIPT).toContain("__vetdScrollAt = null");
});

it("prepare script re-targets the frame before scrolling and the ready expression waits for that scroll", () => {
	const script = scrollPrepareScript('detail"quoted', 1200.6);
	expect(script).toContain('var ID = "detail\\"quoted"');
	expect(script).toContain("var TOP = 1201");
	// 不是目标帧时先切帧、等画完再滚：切帧在滚动之前。
	expect(script.indexOf('type: "show-frame"')).toBeGreaterThan(0);
	expect(script.indexOf("scrollBehavior")).toBeGreaterThan(0);
	// 就绪判据与截图一致（认地址栏显示的帧，重定向帧不会死等），外加滚动已落到位。
	expect(scrollReadyExpression(1200.6)).toBe(`${FRAME_PAINTED_EXPRESSION} && window.__vetdScrollAt === 1201`);
});
