import { describe, expect, it } from "vitest";
import { formatCanvasZoomPercent } from "../src/canvas/canvas-viewport";

describe("formatCanvasZoomPercent", () => {
	it("formats React Flow zoom as an integer percentage", () => {
		expect(formatCanvasZoomPercent(1)).toBe("100%");
		expect(formatCanvasZoomPercent(0.1)).toBe("10%");
		expect(formatCanvasZoomPercent(4)).toBe("400%");
		expect(formatCanvasZoomPercent(1.234)).toBe("123%");
	});

	it("falls back safely for non-finite zoom", () => {
		expect(formatCanvasZoomPercent(Number.NaN)).toBe("100%");
		expect(formatCanvasZoomPercent(Number.POSITIVE_INFINITY)).toBe("100%");
	});
});
