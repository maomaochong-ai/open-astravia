import { describe, expect, it } from "vitest";
import {
	activityMatrixHeightPx,
	buildActivityColumns,
	buildAreaGeometry,
	buildHoverZones,
	buildSmoothPath,
	fitCumulativeColumns,
	trimLeadingIdleColumns,
	type UsageSeriesPointLike,
} from "./token-activity";

function series(days: number, tokensPerDay = 100): UsageSeriesPointLike[] {
	return Array.from({ length: days }, (_, i) => {
		const d = new Date(2025, 0, 1 + i);
		const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
		return { date: iso, tokens: tokensPerDay };
	});
}

describe("fitCumulativeColumns", () => {
	it("采样保留最早与最新的历史，而不是丢弃左侧", () => {
		const columns = buildActivityColumns(series(365), "cumulative");
		const fitted = fitCumulativeColumns(columns, 100);
		expect(fitted).toHaveLength(100);
		expect(fitted[0]?.date).toBe(columns[0]?.date);
		expect(fitted.at(-1)?.date).toBe(columns.at(-1)?.date);
		expect(new Set(fitted.map((c) => c.key)).size).toBe(100);
	});

	it("列数不足容量时铺满宽度，不在左侧补空列", () => {
		const columns = buildActivityColumns(series(3), "cumulative");
		const fitted = fitCumulativeColumns(columns, 6);
		expect(fitted).toHaveLength(3);
		expect(fitted.some((c) => c.isPad)).toBe(false);
		expect(fitted.at(-1)?.tokens).toBe(300);
	});

	it("容量为 1 时保留最新一列", () => {
		const columns = buildActivityColumns(series(5), "cumulative");
		expect(fitCumulativeColumns(columns, 1)).toHaveLength(1);
		expect(fitCumulativeColumns(columns, 1)[0]?.tokens).toBe(500);
		expect(fitCumulativeColumns(columns, 0)).toEqual([]);
	});
});

describe("buildAreaGeometry", () => {
	it("把列映射到 100x100 viewBox 并闭合到底边", () => {
		const columns = buildActivityColumns(series(3), "cumulative");
		const { points, linePath, areaPath } = buildAreaGeometry(columns, 300);
		expect(points.map((p) => p.x)).toEqual([0, 50, 100]);
		// 100 / 200 / 300 tokens → 自底向上
		expect(points.map((p) => Math.round(p.y))).toEqual([67, 33, 0]);
		expect(linePath.startsWith("M0.00")).toBe(true);
		expect(areaPath.endsWith("L100.00 100.00 L0.00 100.00 Z")).toBe(true);
	});

	it("点数不足 2 或无数据时不产生路径", () => {
		expect(buildAreaGeometry([], 100)).toEqual({ points: [], linePath: "", areaPath: "" });
		const one = buildAreaGeometry(buildActivityColumns(series(1), "cumulative"), 100);
		expect(one.points).toHaveLength(1);
		expect(one.linePath).toBe("");
	});

	it("maxTokens 非法时不产生 NaN 或越界坐标", () => {
		const columns = buildActivityColumns(series(3), "cumulative");
		const { points } = buildAreaGeometry(columns, 0);
		expect(points.every((p) => Number.isFinite(p.y) && p.y >= 0 && p.y <= 100)).toBe(true);
	});
});

describe("activityMatrixHeightPx", () => {
	it("与方块矩阵同高，保证切换模式时布局不跳动", () => {
		// 10 列 × 8px + 9 个 2px 间隙 = 98px
		expect(activityMatrixHeightPx(10 * 8 + 9 * 2, 10)).toBeCloseTo(10 * 8 + 9 * 2, 5);
		expect(activityMatrixHeightPx(0, 10)).toBe(0);
		expect(activityMatrixHeightPx(100, 0)).toBe(0);
	});
});

describe("trimLeadingIdleColumns", () => {
	it("裁掉首次请求之前的空白天，只保留一个 0 基线锚点", () => {
		const points = series(10, 0).map((p, i) => ({ ...p, tokens: i >= 6 ? 100 : 0 }));
		const trimmed = trimLeadingIdleColumns(buildActivityColumns(points, "cumulative"));
		expect(trimmed).toHaveLength(5);
		expect(trimmed[0]?.tokens).toBe(0);
		expect(trimmed[1]?.tokens).toBe(100);
		expect(trimmed.at(-1)?.tokens).toBe(400);
	});

	it("首列即有数据时不额外裁剪", () => {
		const trimmed = trimLeadingIdleColumns(buildActivityColumns(series(3), "cumulative"));
		expect(trimmed).toHaveLength(3);
		expect(trimmed[0]?.tokens).toBe(100);
	});

	it("全程无用量时返回空数组", () => {
		expect(trimLeadingIdleColumns(buildActivityColumns(series(5, 0), "cumulative"))).toEqual([]);
	});

	it("重新计算月份刻度，不保留被裁掉那段的起始月", () => {
		const points = series(70, 0).map((p, i) => ({ ...p, tokens: i >= 40 ? 100 : 0 }));
		const trimmed = trimLeadingIdleColumns(buildActivityColumns(points, "cumulative"));
		expect(trimmed[0]?.monthKey).toBe(trimmed[0]?.date.slice(0, 7));
	});
});

describe("buildSmoothPath", () => {
	it("用三次贝塞尔连接数据点，首尾锚在真实数据上", () => {
		const points = [
			{ key: "a", x: 0, y: 100 },
			{ key: "b", x: 50, y: 60 },
			{ key: "c", x: 100, y: 0 },
		];
		const d = buildSmoothPath(points);
		expect(d.startsWith("M0.00 100.00")).toBe(true);
		expect(d.split("C")).toHaveLength(3);
		expect(d.endsWith("100.00 0.00")).toBe(true);
	});

	it("保单调：单调递增序列的曲线不会向下过冲", () => {
		const columns = buildActivityColumns(
			series(12, 0).map((p, i) => ({ ...p, tokens: i === 8 ? 5000 : 10 })),
			"cumulative",
		);
		const { points, linePath } = buildAreaGeometry(columns, 5110);
		// 采样贝塞尔上的控制点纵坐标，均不得低于（y 值不得大于）起点
		const ys = linePath
			.split(/[MC]/)
			.filter(Boolean)
			.flatMap((seg) => seg.trim().split(/\s+/).map(Number))
			.filter((_, i) => i % 2 === 1);
		expect(Math.max(...ys)).toBeLessThanOrEqual(points[0]!.y + 0.01);
	});

	it("点数不足 2 时返回空串", () => {
		expect(buildSmoothPath([])).toBe("");
		expect(buildSmoothPath([{ key: "a", x: 0, y: 0 }])).toBe("");
	});
});

describe("buildHoverZones", () => {
	it("命中区以数据点为中心，延伸到相邻点的中点并铺满宽度", () => {
		const points = [
			{ key: "a", x: 0, y: 0 },
			{ key: "b", x: 50, y: 0 },
			{ key: "c", x: 100, y: 0 },
		];
		const zones = buildHoverZones(points);
		expect(zones.map((z) => z.left)).toEqual([0, 25, 75]);
		expect(zones.reduce((sum, z) => sum + z.width, 0)).toBeCloseTo(100, 5);
	});

	it("单点时铺满整宽，空输入返回空数组", () => {
		expect(buildHoverZones([{ key: "a", x: 0, y: 0 }])).toEqual([{ key: "a", left: 0, width: 100 }]);
		expect(buildHoverZones([])).toEqual([]);
	});
});
