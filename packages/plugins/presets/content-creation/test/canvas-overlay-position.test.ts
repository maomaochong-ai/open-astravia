import { describe, expect, it } from "vitest";
import { clampCanvasOverlayPosition } from "../src/components/canvas-overlay-position";

describe("canvas overlay position", () => {
	it("keeps a floating menu inside all canvas edges", () => {
		expect(
			clampCanvasOverlayPosition({ left: 790, top: 590 }, { width: 240, height: 180 }, { width: 800, height: 600 }),
		).toEqual({ left: 552, top: 412 });
		expect(
			clampCanvasOverlayPosition({ left: -20, top: -10 }, { width: 240, height: 180 }, { width: 800, height: 600 }),
		).toEqual({ left: 8, top: 8 });
	});
});
