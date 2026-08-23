/**
 * 浮层居中件的缩放钳制。只用反向缩放的话，画布缩小时 lscale 会涨到 5、8，
 * 胶囊在世界坐标里比 frame 还宽——一屏几十个 frame 上全是同样大的小人。
 */
import { expect, it } from "vitest";
import { overlayScale } from "../src/canvas/activity-visuals";

it("clamps the inverse scale to a fraction of the frame width", () => {
	// 390 宽的手机稿：胶囊（≈90px）最多长到 160 出头，占 frame 宽度的四成左右。
	expect(overlayScale(390)).toBe("min(var(--astd-lscale, 1), 1.773)");
	// 桌面稿宽得多，上限基本不会咬到——正常缩放下仍是恒定屏幕大小。
	expect(overlayScale(1440)).toBe("min(var(--astd-lscale, 1), 6.545)");
});

it("never emits a zero or negative cap", () => {
	// 拖出一个还没成形的 frame 时宽度可能是 0，scale(0) 会让浮层整个消失。
	expect(overlayScale(0)).toBe("min(var(--astd-lscale, 1), 0.005)");
});
