import { describe, expect, it } from "vitest";
import { planCover } from "../src/canvas/cover-compose";

describe("planCover", () => {
	it("takes the bounding box of every frame, not just the first", () => {
		const plan = planCover([
			{ x: 100, y: 50, width: 400, height: 300 },
			{ x: 600, y: 50, width: 400, height: 800 },
		]);
		expect(plan?.bounds).toEqual({ x: 100, y: 50, width: 900, height: 800 });
	});

	it("shrinks to the long-edge cap without changing the aspect ratio", () => {
		const plan = planCover([{ x: 0, y: 0, width: 8000, height: 2000 }], 2000);
		expect(plan?.scale).toBeCloseTo(0.25);
		expect(plan?.width).toBe(2000);
		expect(plan?.height).toBe(500);
	});

	it("never upscales a small canvas", () => {
		const plan = planCover([{ x: 0, y: 0, width: 320, height: 200 }], 2000);
		expect(plan?.scale).toBe(1);
		expect(plan?.width).toBe(320);
	});

	it("negative coordinates still land inside the bounding box", () => {
		const plan = planCover([
			{ x: -500, y: -200, width: 100, height: 100 },
			{ x: 0, y: 0, width: 100, height: 100 },
		]);
		expect(plan?.bounds).toEqual({ x: -500, y: -200, width: 600, height: 300 });
	});

	it("has nothing to draw for an empty or degenerate canvas", () => {
		expect(planCover([])).toBeNull();
		expect(planCover([{ x: 0, y: 0, width: 0, height: 0 }])).toBeNull();
	});
});
