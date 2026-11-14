import { describe, expect, it, vi } from "vitest";
import { handleHorizontalWheel, resolveHorizontalWheel } from "./horizontal-wheel-scroll";

/**
 * 输入工具行在台式机上只能靠滚轮左右移动（触控板可以两指横扫）。
 * 两条边界必须同时成立：溢出时把纵向滚轮吃掉；不溢出时别抢页面的滚动。
 */
describe("工具行的横向滚轮", () => {
	it("溢出时纵向滚轮映射为横向滚动", () => {
		const result = resolveHorizontalWheel({ scrollLeft: 0, scrollWidth: 600, clientWidth: 300 }, 0, 80, 0);
		expect(result).toEqual({ handled: true, scrollLeft: 80 });
	});

	it("不溢出时不拦截，页面照常滚动", () => {
		const result = resolveHorizontalWheel({ scrollLeft: 0, scrollWidth: 300, clientWidth: 300 }, 0, 80, 0);
		expect(result).toEqual({ handled: false, scrollLeft: 0 });
	});

	it("滚到头仍然吞掉这次事件，避免页面跟着抖一下", () => {
		const result = resolveHorizontalWheel({ scrollLeft: 300, scrollWidth: 600, clientWidth: 300 }, 0, 80, 0);
		expect(result).toEqual({ handled: true, scrollLeft: 300 });
	});

	it("按行滚动的设备（deltaMode=1）按行高换算", () => {
		const result = resolveHorizontalWheel({ scrollLeft: 0, scrollWidth: 600, clientWidth: 300 }, 0, 3, 1);
		expect(result.scrollLeft).toBe(60);
	});

	it("有横向分量时优先用 deltaX", () => {
		const result = resolveHorizontalWheel({ scrollLeft: 0, scrollWidth: 600, clientWidth: 300 }, 40, 5, 0);
		expect(result.scrollLeft).toBe(40);
	});

	it("DOM 适配层在拦截时写回 scrollLeft", () => {
		const preventDefault = vi.fn();
		const target = { scrollLeft: 0, scrollWidth: 600, clientWidth: 300 } as unknown as HTMLElement;
		handleHorizontalWheel({ deltaX: 0, deltaY: 50, deltaMode: 0, currentTarget: target, preventDefault });

		expect(preventDefault).toHaveBeenCalled();
		expect((target as unknown as { scrollLeft: number }).scrollLeft).toBe(50);
	});
});
