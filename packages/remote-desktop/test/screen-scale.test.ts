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

	it("keeps the full size while the capture's size is unknown", () => {
		expect(screenScaleDown(undefined, true)).toBe(1);
	});
});
