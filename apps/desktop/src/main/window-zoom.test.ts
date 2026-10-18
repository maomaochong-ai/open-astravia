import { describe, expect, it } from "vitest";
import { isZoomDirection, nextZoomLevel } from "./window-zoom.js";

describe("nextZoomLevel", () => {
	it("steps one half level per press and round-trips back to 100%", () => {
		expect(nextZoomLevel(0, "in")).toBe(0.5);
		expect(nextZoomLevel(0.5, "in")).toBe(1);
		expect(nextZoomLevel(1, "out")).toBe(0.5);
		expect(nextZoomLevel(0.5, "out")).toBe(0);
	});

	it("resets to 100% from any level", () => {
		expect(nextZoomLevel(2.5, "reset")).toBe(0);
		expect(nextZoomLevel(-3, "reset")).toBe(0);
	});

	it("pins the range so a user cannot zoom into an unrecoverable state", () => {
		expect(nextZoomLevel(3, "in")).toBe(3);
		expect(nextZoomLevel(-3, "out")).toBe(-3);
	});

	it("keeps the level free of float noise", () => {
		let level = 0;
		for (let index = 0; index < 6; index += 1) level = nextZoomLevel(level, "in");
		expect(level).toBe(3);
		level = nextZoomLevel(level, "out");
		expect(level).toBe(2.5);
	});
});

describe("isZoomDirection", () => {
	it("accepts only the three known directions", () => {
		expect(isZoomDirection("in")).toBe(true);
		expect(isZoomDirection("out")).toBe(true);
		expect(isZoomDirection("reset")).toBe(true);
		expect(isZoomDirection("zoom")).toBe(false);
		expect(isZoomDirection(1)).toBe(false);
		expect(isZoomDirection(undefined)).toBe(false);
	});
});
