import { describe, expect, it } from "vitest";
import { layoutMockup } from "../src/mockup/layout";
import { defaultOptions } from "../src/mockup/options";
import type { MockupShot } from "../src/mockup/types";

const options = { ...defaultOptions(844), borderWidth: 10 };

function shot(id: string): MockupShot {
	return { frameId: id, title: id, cssWidth: 390, cssHeight: 844, image: null };
}

describe("layoutMockup slots", () => {
	// 末页画框少，如果按实际个数排，第二页就比第一页窄一大截，叠成长图/PDF 会一页宽一页窄。
	it("reserves the missing slots so every page keeps the full width", () => {
		const full = layoutMockup([shot("a"), shot("b"), shot("c")], options, 3);
		const last = layoutMockup([shot("d")], options, 3);
		expect(last.width).toBeCloseTo(full.width);
		expect(last.rects).toHaveLength(1);
	});

	// 空位排在末尾：内容仍按阅读顺序从左往右，不会在左边先空出一块。
	it("keeps the staged frames left-aligned and the empty slots trailing", () => {
		const padded = layoutMockup([shot("a")], options, 3);
		const tight = layoutMockup([shot("a")], options, 1);
		expect(padded.rects[0]).toEqual(tight.rects[0]);
	});

	it("ignores a slot count below the staged frames", () => {
		const two = layoutMockup([shot("a"), shot("b")], options, 1);
		expect(two.width).toBeCloseTo(layoutMockup([shot("a"), shot("b")], options).width);
		expect(two.rects).toHaveLength(2);
	});

	it("has no layout without frames", () => {
		expect(layoutMockup([], options, 3).width).toBe(0);
	});
});
