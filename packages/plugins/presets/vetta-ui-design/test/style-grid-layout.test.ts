import { describe, expect, it } from "vitest";
import {
	STYLE_GRID_GAP,
	STYLE_GRID_MAX_COLUMNS,
	styleGridMetrics,
	styleGridWindow,
} from "../src/new-session/style-grid-layout";

describe("style grid metrics", () => {
	it("drops to fewer columns on narrow viewports", () => {
		// 手机宽度的会话页：三列会把每张卡压到 100px 出头，demo 里什么都看不清。
		expect(styleGridMetrics(380).columns).toBe(1);
		expect(styleGridMetrics(600).columns).toBe(2);
		expect(styleGridMetrics(1200).columns).toBe(STYLE_GRID_MAX_COLUMNS);
	});

	it("never exceeds the column cap however wide the page gets", () => {
		expect(styleGridMetrics(4000).columns).toBe(STYLE_GRID_MAX_COLUMNS);
	});

	it("derives row height from the measured card width", () => {
		const { columns, rowHeight } = styleGridMetrics(1200);
		const card = (1200 - STYLE_GRID_GAP * (columns - 1)) / columns;
		expect(rowHeight).toBeCloseTo((card * 3) / 4 + STYLE_GRID_GAP);
	});

	it("reports no row height before the first measurement", () => {
		// 宽度未知时调用方要能认出「还算不出窗口」，退回全量渲染而不是留白一屏。
		expect(styleGridMetrics(0).rowHeight).toBe(0);
	});
});

describe("style grid window", () => {
	const metrics = { columns: 3, rowHeight: 100 };

	it("renders everything until the row height is known", () => {
		expect(
			styleGridWindow({ scrolledPast: 0, viewportHeight: 800, metrics: { columns: 3, rowHeight: 0 }, total: 42 }),
		).toEqual({ start: 0, end: 42 });
	});

	it("keeps one row of overscan above the viewport", () => {
		// 滚过 5 行时从第 4 行起渲染：正上方那一行提前挂好，滑上去不会看到空档。
		expect(styleGridWindow({ scrolledPast: 500, viewportHeight: 400, metrics, total: 300 }).start).toBe(4 * 3);
	});

	it("never starts above the first row", () => {
		expect(styleGridWindow({ scrolledPast: 0, viewportHeight: 400, metrics, total: 300 }).start).toBe(0);
		expect(styleGridWindow({ scrolledPast: -200, viewportHeight: 400, metrics, total: 300 }).start).toBe(0);
	});

	it("clamps the tail to the catalog size", () => {
		const window = styleGridWindow({ scrolledPast: 0, viewportHeight: 4000, metrics, total: 20 });
		expect(window.end).toBe(20);
	});

	it("covers the viewport plus overscan on both sides", () => {
		// 视口 400px / 行高 100px = 4 行，上下各补一行 → 6 行 × 3 列。
		const window = styleGridWindow({ scrolledPast: 1000, viewportHeight: 400, metrics, total: 300 });
		expect(window.end - window.start).toBe(6 * 3);
	});
});
