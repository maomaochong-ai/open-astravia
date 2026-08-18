import { describe, expect, it, vi } from "vitest";
import { createUserActivityReporter } from "./user-activity";

describe("createUserActivityReporter", () => {
	it("sends the first activity immediately", () => {
		const send = vi.fn();
		const reporter = createUserActivityReporter(send, { now: () => 100 });

		reporter.report();

		expect(send).toHaveBeenCalledOnce();
	});

	it("coalesces activity within the throttle window", () => {
		const send = vi.fn();
		let currentTime = 1_000;
		const reporter = createUserActivityReporter(send, { now: () => currentTime, throttleMs: 100 });

		reporter.report();
		currentTime = 1_099;
		reporter.report();
		currentTime = 1_100;
		reporter.report();

		expect(send).toHaveBeenCalledTimes(2);
	});

	it("does not depend on wall-clock Date.now", () => {
		const send = vi.fn();
		let currentTime = 0;
		const reporter = createUserActivityReporter(send, { now: () => currentTime, throttleMs: 10 });

		reporter.report();
		currentTime = -1;
		reporter.report();

		expect(send).toHaveBeenCalledOnce();
	});
});
