import { describe, expect, it } from "vitest";
import { isSoftwareEncoder, screenScaleDown } from "../src/screen-scale.js";

describe("remote desktop screen scale", () => {
	it("tells Chromium's software encoders from the hardware ones", () => {
		expect(isSoftwareEncoder("OpenH264")).toBe(true);
		expect(isSoftwareEncoder("libvpx")).toBe(true);
		expect(isSoftwareEncoder("MediaFoundationVideoEncodeAccelerator")).toBe(false);
		expect(isSoftwareEncoder("ExternalEncoder")).toBe(false);
	});

	it("sends the full capture through a hardware encoder", () => {
		expect(screenScaleDown({ width: 2560, height: 1600 }, false)).toBe(1);
	});

	it("halves the software encoder's work on a large screen, and leaves a small one as is", () => {
		expect(screenScaleDown({ width: 2560, height: 1600 }, true)).toBe(1.33);
		expect(screenScaleDown({ width: 1920, height: 1080 }, true)).toBe(1);
	});

	it("sends no more than the phone shows, in a few steps of at most half", () => {
		const capture = { width: 2560, height: 1600 };
		// A phone upright: the screen across 1440 pixels.
		expect(screenScaleDown(capture, false, { width: 1440, height: 900 })).toBe(1.5);
		// Sideways, nearly the capture's own size; zoomed in, more than it.
		expect(screenScaleDown(capture, false, { width: 2304, height: 1440 })).toBe(1);
		expect(screenScaleDown(capture, false, { width: 5120, height: 3200 })).toBe(1);
		// A small window still gets half, not less.
		expect(screenScaleDown(capture, false, { width: 320, height: 200 })).toBe(2);
	});

	it("takes whichever is smaller of what the phone shows and what software can encode", () => {
		const capture = { width: 2560, height: 1600 };
		expect(screenScaleDown(capture, true, { width: 2304, height: 1440 })).toBe(1.33);
		expect(screenScaleDown(capture, true, { width: 1000, height: 625 })).toBe(2);
	});

	it("keeps the full size while the capture's size is unknown", () => {
		expect(screenScaleDown(undefined, true)).toBe(1);
	});
});
