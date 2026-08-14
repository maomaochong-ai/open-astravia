import { describe, expect, it } from "vitest";
import {
	centerView,
	clampScale,
	fitView,
	MAX_SCALE,
	MIN_SCALE,
	panBy,
	stackPages,
	zoomAt,
} from "../src/mockup/workbench-view";

describe("workbench view transform", () => {
	it("fits the content into the viewport and centers it", () => {
		const view = fitView({ width: 1000, height: 500 }, { width: 548, height: 1000 }, 24);
		expect(view.scale).toBeCloseTo(0.5);
		expect(view.x).toBeCloseTo(24);
		expect(view.y).toBeCloseTo(375);
	});

	// 渲染图本来就是高分辨率合成图，一进来被拉过 100% 只会让人以为它糊了。
	it("never fits above 100%", () => {
		expect(fitView({ width: 10, height: 10 }, { width: 1000, height: 1000 }).scale).toBe(1);
	});

	it("survives an unmeasured viewport", () => {
		expect(fitView({ width: 100, height: 100 }, { width: 0, height: 0 })).toEqual({ scale: 1, x: 0, y: 0 });
	});

	it("clamps the scale to the usable range", () => {
		expect(clampScale(1000)).toBe(MAX_SCALE);
		expect(clampScale(0)).toBe(MIN_SCALE);
		expect(clampScale(Number.NaN)).toBe(1);
	});

	// 缩放锚点：光标下的那一点必须原地不动，否则放大几次内容就飘出视口了。
	it("keeps the point under the cursor fixed while zooming", () => {
		const before = { scale: 1, x: 40, y: 10 };
		const point = { x: 200, y: 120 };
		const after = zoomAt(before, 2, point);
		const worldBefore = { x: (point.x - before.x) / before.scale, y: (point.y - before.y) / before.scale };
		const worldAfter = { x: (point.x - after.x) / after.scale, y: (point.y - after.y) / after.scale };
		expect(after.scale).toBe(2);
		expect(worldAfter.x).toBeCloseTo(worldBefore.x);
		expect(worldAfter.y).toBeCloseTo(worldBefore.y);
	});

	// 撞到上下限时 factor 兑现不了，用它算平移就会漂。
	it("keeps the anchor fixed even when the zoom is clamped", () => {
		const before = { scale: MAX_SCALE, x: 0, y: 0 };
		const after = zoomAt(before, 4, { x: 100, y: 100 });
		expect(after.scale).toBe(MAX_SCALE);
		expect(after.x).toBe(0);
		expect(after.y).toBe(0);
	});

	it("pans without touching the scale", () => {
		expect(panBy({ scale: 0.5, x: 10, y: 20 }, -5, 7)).toEqual({ scale: 0.5, x: 5, y: 27 });
	});

	it("centers at a given scale", () => {
		expect(centerView({ width: 100, height: 50 }, { width: 300, height: 150 }, 1)).toEqual({
			scale: 1,
			x: 100,
			y: 50,
		});
	});
});

describe("stackPages", () => {
	// 末页画框少、因而更窄：左对齐会让整叠图看着像歪了。
	it("stacks pages vertically and centers the narrower ones", () => {
		const { world, boxes } = stackPages(
			[
				{ width: 300, height: 100 },
				{ width: 100, height: 80 },
			],
			20,
		);
		expect(world).toEqual({ width: 300, height: 200 });
		expect(boxes[0]).toEqual({ left: 0, top: 0, width: 300, height: 100 });
		expect(boxes[1]).toEqual({ left: 100, top: 120, width: 100, height: 80 });
	});

	it("has no world when there are no pages", () => {
		expect(stackPages([], 20)).toEqual({ world: { width: 0, height: 0 }, boxes: [] });
	});
});
