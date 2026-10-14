import { describe, expect, it } from "vitest";
import { ScreenAdaptation } from "../src/screen-adaptation.js";
import type { ScreenStreamSample } from "../src/screen-stats.js";

const capture = { width: 2560, height: 1600 };
const healthy: ScreenStreamSample = {
	timestamp: 0,
	sourceFps: 30,
	encodedFps: 30,
	encodeMs: 12,
	limitedBy: "none",
	availableKbps: 6000,
	sentKbps: 3000,
};

describe("screen adaptation", () => {
	it("reduces sustained moving overload, holds through a brief recovery, then restores detail", () => {
		const policy = new ScreenAdaptation();
		for (let timestamp = 0; timestamp <= 2000; timestamp += 1000)
			policy.observe({ ...healthy, timestamp, limitedBy: "bandwidth", encodedFps: 4 }, capture, true);
		const reduced = policy.scale(capture, true);
		expect(reduced).toBeGreaterThan(1.34);
		for (let timestamp = 3000; timestamp < 13_000; timestamp += 1000)
			policy.observe({ ...healthy, timestamp }, capture, true);
		expect(policy.scale(capture, true)).toBe(reduced);
		policy.observe({ ...healthy, timestamp: 13_000 }, capture, true);
		expect(policy.scale(capture, true)).toBe(1.34);
	});

	it("does not treat a still desktop or one transient slow sample as overload", () => {
		const policy = new ScreenAdaptation();
		policy.observe({ ...healthy, encodeMs: 70 }, capture, false);
		for (let timestamp = 1000; timestamp <= 20_000; timestamp += 1000)
			policy.observe({ ...healthy, timestamp, sourceFps: 1, encodedFps: 1, encodeMs: 40 }, capture, false);
		expect(policy.scale(capture, false)).toBe(1);
	});

	it("ignores stale samples, breaks streaks over gaps and stays within the minimum picture size", () => {
		const policy = new ScreenAdaptation();
		const pressure = { ...healthy, limitedBy: "cpu", encodeMs: 50 };
		policy.observe(pressure, capture, false);
		policy.observe({ ...pressure, timestamp: 8000 }, capture, false);
		policy.observe({ ...pressure, timestamp: 7000 }, capture, false);
		expect(policy.scale(capture, false)).toBe(1);
		for (let timestamp = 9000; timestamp <= 100_000; timestamp += 1000)
			policy.observe({ ...pressure, timestamp }, capture, false);
		expect(policy.scale(capture, false)).toBe(4);
		policy.reset();
		expect(policy.scale(capture, false)).toBe(1);
	});

	it("does not increase resolution without encode and bandwidth headroom", () => {
		const policy = new ScreenAdaptation();
		for (let timestamp = 0; timestamp <= 2000; timestamp += 1000)
			policy.observe({ ...healthy, timestamp, encodeMs: 45 }, capture, false);
		for (let timestamp = 3000; timestamp <= 30_000; timestamp += 1000)
			policy.observe({ ...healthy, timestamp, availableKbps: 3100 }, capture, false);
		expect(policy.scale(capture, false)).toBe(1.25);
	});
});
