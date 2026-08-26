import { describe, expect, it } from "vitest";
import { ConsecutiveFailureCircuitBreaker } from "../../src/kernel/index.js";

describe("ConsecutiveFailureCircuitBreaker", () => {
	it("opens after the configured number of consecutive failures and resets after cooldown", () => {
		let now = 100;
		const breaker = new ConsecutiveFailureCircuitBreaker({
			maxConsecutiveFailures: 2,
			resetAfterMs: 50,
			now: () => now,
		});

		breaker.recordFailure();
		expect(breaker.canAttempt()).toBe(true);
		breaker.recordFailure();
		expect(breaker.readSnapshot()).toEqual({ consecutiveFailures: 2, open: true, retryAt: 150 });

		now = 149;
		expect(breaker.canAttempt()).toBe(false);
		now = 150;
		expect(breaker.canAttempt()).toBe(true);
		expect(breaker.readSnapshot()).toEqual({ consecutiveFailures: 0, open: false });
	});

	it("resets the failure sequence after a success", () => {
		const breaker = new ConsecutiveFailureCircuitBreaker({ maxConsecutiveFailures: 2 });
		breaker.recordFailure();
		breaker.recordSuccess();
		expect(breaker.readSnapshot()).toEqual({ consecutiveFailures: 0, open: false });
	});

	it.each([
		[{ maxConsecutiveFailures: 0 }, "maxConsecutiveFailures"],
		[{ resetAfterMs: -1 }, "resetAfterMs"],
	] as const)("rejects invalid options", (options, expected) => {
		expect(() => new ConsecutiveFailureCircuitBreaker(options)).toThrow(expected);
	});
});
