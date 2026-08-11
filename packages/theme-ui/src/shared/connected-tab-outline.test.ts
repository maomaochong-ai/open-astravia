import { describe, expect, it } from "vitest";
import { createConnectedTabOutlineGeometry } from "./connected-tab-outline";

describe("createConnectedTabOutlineGeometry", () => {
	it("creates one continuous outline around the tab and both join curves", () => {
		expect(createConnectedTabOutlineGeometry(72)).toEqual({
			fillPath:
				"M 0 32 A 8 8 0 0 0 8 24 V 8 A 8 8 0 0 1 16 0 H 72 A 8 8 0 0 1 80 8 V 24 A 8 8 0 0 0 88 32 V 34 H 0 Z",
			height: 34,
			offsetX: 8,
			outlinePath: "M 0 32 A 8 8 0 0 0 8 24 V 8 A 8 8 0 0 1 16 0 H 72 A 8 8 0 0 1 80 8 V 24 A 8 8 0 0 0 88 32",
			width: 88,
		});
	});

	it("keeps radii valid when the measured tab is narrower than both top corners", () => {
		const geometry = createConnectedTabOutlineGeometry(10);

		expect(geometry.width).toBe(32);
		expect(geometry.outlinePath).toContain("H 16 A 8 8 0 0 1 24 8");
	});
});
