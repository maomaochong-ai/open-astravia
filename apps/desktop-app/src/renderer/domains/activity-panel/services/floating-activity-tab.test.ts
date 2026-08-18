import { describe, expect, it } from "vitest";
import {
	clampFloatingTabRect,
	createFloatingTabRect,
	hasLeftTabStrip,
	insertDockedTabAtPoint,
	isInsideTabStrip,
	mergeDockedTabOrder,
	moveFloatingTabRect,
	resizeFloatingTabRect,
} from "./floating-activity-tab";

const workspace = { left: 0, top: 0, right: 1200, bottom: 760, width: 1200, height: 760 };

describe("floating activity tab", () => {
	it("distinguishes reordering from leaving the main tab strip", () => {
		const strip = { left: 800, top: 70, right: 1180, bottom: 100, width: 380, height: 30 };
		expect(hasLeftTabStrip({ x: 900, y: 95 }, strip)).toBe(false);
		expect(hasLeftTabStrip({ x: 900, y: 125 }, strip)).toBe(true);
		expect(isInsideTabStrip({ x: 790, y: 65 }, strip)).toBe(true);
		expect(isInsideTabStrip({ x: 780, y: 65 }, strip)).toBe(false);
	});

	it("creates a floating tab while retaining the pointer anchor", () => {
		const result = createFloatingTabRect({
			panel: { left: 840, top: 60, right: 1200, bottom: 760, width: 360, height: 700 },
			point: { x: 920, y: 82 },
			workspace,
			minWidth: 260,
		});
		expect(result.offset).toEqual({ x: 80, y: 22 });
		expect(result.rect).toEqual({ x: 832, y: 60, width: 360, height: 570 });
	});

	it("constrains moving and resizing to the viewport", () => {
		const rect = { x: 400, y: 160, width: 360, height: 400 };
		expect(moveFloatingTabRect(rect, { x: 10, y: 5 }, { x: 80, y: 20 }, workspace, 260)).toEqual({
			x: 8,
			y: 8,
			width: 360,
			height: 400,
		});
		expect(resizeFloatingTabRect(rect, { x: -300, y: 500 }, workspace, 260)).toEqual({
			x: 400,
			y: 8,
			width: 260,
			height: 744,
		});
		expect(clampFloatingTabRect({ x: 1100, y: 700, width: 500, height: 500 }, workspace, 260)).toEqual({
			x: 692,
			y: 252,
			width: 500,
			height: 500,
		});
	});

	it("preserves floating slots when docked tabs are reordered", () => {
		expect(mergeDockedTabOrder(["a", "b", "c", "d"], new Set(["b"]), ["d", "a", "c"])).toEqual(["d", "b", "a", "c"]);
	});

	it("inserts a returning tab at the pointer position", () => {
		const centers = [
			{ key: "a", centerX: 100 },
			{ key: "c", centerX: 300 },
		];
		expect(insertDockedTabAtPoint(["a", "c"], "b", centers, 220)).toEqual(["a", "b", "c"]);
		expect(insertDockedTabAtPoint(["a", "c"], "b", centers, 350)).toEqual(["a", "c", "b"]);
	});
});
