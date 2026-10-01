import { describe, expect, it } from "vitest";
import {
	galleryColumnCount,
	growVisibleCount,
	hasMoreProjects,
	homeVisibleCount,
	initialVisibleCount,
	PROJECT_CARD_MIN_WIDTH,
	PROJECT_GRID_CLASS,
	PROJECT_GRID_GAP,
	PROJECTS_PAGE_SIZE,
} from "../src/gallery/gallery-layout";

describe("galleryColumnCount", () => {
	it("与 auto-fill 公式一致：n 列成立当且仅当 n*min + (n-1)*gap <= width", () => {
		const min = PROJECT_CARD_MIN_WIDTH;
		const gap = PROJECT_GRID_GAP;
		// 恰好放下 3 列的宽度。
		const threeExact = 3 * min + 2 * gap;
		expect(galleryColumnCount(threeExact)).toBe(3);
		// 差 1px 就退回 2 列。
		expect(galleryColumnCount(threeExact - 1)).toBe(2);
		expect(galleryColumnCount(min)).toBe(1);
	});

	it("容器还没量出来（宽度 0/负数/NaN）按 1 列，宁少勿多", () => {
		expect(galleryColumnCount(0)).toBe(1);
		expect(galleryColumnCount(-100)).toBe(1);
		expect(galleryColumnCount(Number.NaN)).toBe(1);
	});

	it("窄到一张卡都放不下时仍是 1 列（CSS 的 minmax 也会压缩单列）", () => {
		expect(galleryColumnCount(50)).toBe(1);
	});

	it("常量必须与宫格 CSS 保持同步", () => {
		expect(PROJECT_GRID_CLASS).toContain(`minmax(${PROJECT_CARD_MIN_WIDTH}px`);
		// gap-3 = 12px。
		expect(PROJECT_GRID_GAP).toBe(12);
		expect(PROJECT_GRID_CLASS).toContain("gap-3");
	});
});

describe("homeVisibleCount / hasMoreProjects", () => {
	it("最多 3 行：4 列 20 张卡只露 12 张，且需要「查看全部」", () => {
		expect(homeVisibleCount(20, 4)).toBe(12);
		expect(hasMoreProjects(20, 4)).toBe(true);
	});

	it("不足 3 行时全放，不出现「查看全部」", () => {
		expect(homeVisibleCount(5, 4)).toBe(5);
		expect(hasMoreProjects(5, 4)).toBe(false);
		expect(homeVisibleCount(12, 4)).toBe(12);
		expect(hasMoreProjects(12, 4)).toBe(false);
	});

	it("列数异常（0）时按 1 列兜底", () => {
		expect(homeVisibleCount(10, 0)).toBe(3);
	});
});

describe("列表页分页", () => {
	it("首屏一页，滚到底部逐页追加，封顶到总数", () => {
		const total = PROJECTS_PAGE_SIZE * 2 + 5;
		let visible = initialVisibleCount(total);
		expect(visible).toBe(PROJECTS_PAGE_SIZE);
		visible = growVisibleCount(visible, total);
		expect(visible).toBe(PROJECTS_PAGE_SIZE * 2);
		visible = growVisibleCount(visible, total);
		expect(visible).toBe(total);
		// 已经到底后再追加不越界。
		expect(growVisibleCount(visible, total)).toBe(total);
	});

	it("总数比一页少时首屏就是全部", () => {
		expect(initialVisibleCount(3)).toBe(3);
		expect(initialVisibleCount(0)).toBe(0);
	});
});
