/**
 * 分块拼接的合同：拼出来的整图每一行内容恰好出现一次——不重叠、不缺行、容器
 * 上下的固定部分各带一次。
 */
import { expect, it } from "vitest";
import { planTiles, type TilePlan } from "../src/materials/tile-plan";

/** 把每块取出的行按 dest 位置铺开，验证整图连续且无重叠。 */
function coverage(plan: TilePlan): { contiguous: boolean; rows: number } {
	const sorted = [...plan.tiles].sort((a, b) => a.destTop - b.destTop);
	let cursor = 0;
	for (const tile of sorted) {
		if (tile.destTop !== cursor) return { contiguous: false, rows: cursor };
		cursor += tile.srcBottom - tile.srcTop;
	}
	return { contiguous: true, rows: cursor };
}

it("keeps a frame that fits as one untouched tile", () => {
	const plan = planTiles({ viewportHeight: 844, top: 0, bottom: 844, hidden: 0 });
	expect(plan.height).toBe(844);
	expect(plan.tiles).toEqual([{ scrollTop: 0, srcTop: 0, srcBottom: 844, destTop: 0 }]);
});

it("pages a scrolling document and crops the overlap of the final page", () => {
	// 1000px 视口，还藏着 2500px：最后一页只能滚到 2500，与上一页重叠 500 行。
	const plan = planTiles({ viewportHeight: 1000, top: 0, bottom: 1000, hidden: 2500 });
	expect(plan.height).toBe(3500);
	expect(plan.tiles.map((tile) => tile.scrollTop)).toEqual([0, 1000, 2000, 2500]);
	expect(plan.tiles[3]).toEqual({ scrollTop: 2500, srcTop: 500, srcBottom: 1000, destTop: 3000 });
	expect(coverage(plan)).toEqual({ contiguous: true, rows: 3500 });
});

it("carries the chrome above and below an inner scroller exactly once", () => {
	// App 骨架：60px 顶栏 + 700px 可滚内容区 + 84px 底部 tab；内容区还藏着 1000px。
	const plan = planTiles({ viewportHeight: 844, top: 60, bottom: 760, hidden: 1000 });
	expect(plan.height).toBe(1844);
	// 第一块从视口顶端取到内容区底部（顶栏跟着进来），最后一块取到视口底部（底部 tab 跟着进来）。
	expect(plan.tiles[0]).toEqual({ scrollTop: 0, srcTop: 0, srcBottom: 760, destTop: 0 });
	expect(plan.tiles.at(-1)).toEqual({ scrollTop: 1000, srcTop: 460, srcBottom: 844, destTop: 1460 });
	expect(coverage(plan)).toEqual({ contiguous: true, rows: 1844 });
	// 中间每块都只取内容区那一段。
	for (const tile of plan.tiles.slice(1, -1)) {
		expect(tile.srcTop).toBe(60);
		expect(tile.srcBottom).toBe(760);
	}
});

it.each([
	[1, 1000, 0, 1000],
	[999, 1000, 0, 1000],
	[1001, 1000, 0, 1000],
	[4321, 4096, 88, 4000],
])("covers %d hidden px without gaps", (hidden, viewportHeight, top, bottom) => {
	const plan = planTiles({ viewportHeight, top, bottom, hidden });
	expect(coverage(plan)).toEqual({ contiguous: true, rows: viewportHeight + hidden });
	for (const tile of plan.tiles) {
		expect(tile.srcTop).toBeGreaterThanOrEqual(0);
		expect(tile.srcBottom).toBeLessThanOrEqual(viewportHeight);
		expect(tile.srcBottom).toBeGreaterThan(tile.srcTop);
	}
});
