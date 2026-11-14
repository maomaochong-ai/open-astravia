import { describe, expect, it } from "vitest";
import {
	computeManageSessionsRange,
	MANAGE_SESSIONS_ROW_HEIGHT,
	MANAGE_SESSIONS_VIRTUAL_THRESHOLD,
	manageSessionsScrollTopFor,
} from "./manage-sessions-range";

/**
 * 「管理会话」在几百条历史时只挂载可见的几十行。行高固定，区间由滚动位移直接算，
 * 边界（阈值、滚到底、行高为 0）必须稳定，否则会出现空白或漏渲染的行。
 */
describe("管理会话长列表窗口化", () => {
	it("阈值（80 条）及以下全量渲染", () => {
		const range = computeManageSessionsRange({
			scrollTop: 0,
			viewportHeight: 400,
			rowHeight: MANAGE_SESSIONS_ROW_HEIGHT,
			count: MANAGE_SESSIONS_VIRTUAL_THRESHOLD,
		});
		expect(range).toEqual({
			start: 0,
			end: MANAGE_SESSIONS_VIRTUAL_THRESHOLD,
			paddingTop: 0,
			paddingBottom: 0,
		});
	});

	it("超过阈值只渲染可见区间与缓冲，上下留出等高空白", () => {
		const range = computeManageSessionsRange({ scrollTop: 360, viewportHeight: 360, rowHeight: 36, count: 500 });
		// 360/36 = 第 10 行；向上 6 行缓冲 → 4；可视 11 行 + 6 行缓冲 → 27。
		expect(range.start).toBe(4);
		expect(range.end).toBe(27);
		expect(range.paddingTop).toBe(4 * 36);
		expect(range.paddingBottom).toBe((500 - 27) * 36);
	});

	it("滚到底不越界", () => {
		const range = computeManageSessionsRange({ scrollTop: 1e6, viewportHeight: 300, rowHeight: 36, count: 100 });
		expect(range.end).toBe(100);
		expect(range.paddingBottom).toBe(0);
	});

	it("行高为 0 时退回全量，不除零", () => {
		const range = computeManageSessionsRange({ scrollTop: 100, viewportHeight: 300, rowHeight: 0, count: 200 });
		expect(range.end).toBe(200);
	});

	it("选中项在窗口外时给出贴边的滚动位置，在窗口内不需要滚动", () => {
		const top = computeManageSessionsRange({ scrollTop: 0, viewportHeight: 360, rowHeight: 36, count: 500 });
		expect(
			manageSessionsScrollTopFor({ index: 10, rowHeight: 36, viewportHeight: 360, scrollTop: 0 }, top),
		).toBeNull();
		expect(manageSessionsScrollTopFor({ index: 200, rowHeight: 36, viewportHeight: 360, scrollTop: 0 }, top)).toBe(
			200 * 36 - 360 + 36,
		);
		const scrolled = computeManageSessionsRange({ scrollTop: 3600, viewportHeight: 360, rowHeight: 36, count: 500 });
		expect(
			manageSessionsScrollTopFor({ index: 0, rowHeight: 36, viewportHeight: 360, scrollTop: 3600 }, scrolled),
		).toBe(0);
	});
});
