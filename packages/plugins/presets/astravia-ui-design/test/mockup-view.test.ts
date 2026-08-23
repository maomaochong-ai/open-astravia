import { describe, expect, it } from "vitest";
import { centerViewport, stackPages } from "../src/mockup/workbench-view";

// 视图的缩放/平移/fit 与画布共用 canvas/use-viewport，由 viewport.test.ts 覆盖；
// 这里只测工作台自己的纯几何。

describe("centerViewport", () => {
	it("centers at a given zoom", () => {
		expect(centerViewport({ width: 100, height: 50 }, { width: 300, height: 150 }, 1)).toEqual({
			zoom: 1,
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

	it("returns an empty world for no pages", () => {
		expect(stackPages([], 10)).toEqual({ world: { width: 0, height: 0 }, boxes: [] });
	});
});
