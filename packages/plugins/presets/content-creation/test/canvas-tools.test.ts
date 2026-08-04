import { describe, expect, it } from "vitest";
import { DEFAULT_CANVAS_TOOL, getCanvasInteraction } from "../src/canvas/canvas-tools";

describe("canvas tools", () => {
	it("defaults to panning and maps each tool to one primary-button interaction", () => {
		expect(DEFAULT_CANVAS_TOOL).toBe("pan");
		expect(getCanvasInteraction("pan")).toEqual({ selectionOnDrag: false, panOnDrag: true });
		expect(getCanvasInteraction("select")).toEqual({ selectionOnDrag: true, panOnDrag: false });
	});
});
