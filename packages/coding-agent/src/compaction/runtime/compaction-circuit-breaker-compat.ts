import {
	ConsecutiveFailureCircuitBreaker,
	type ConsecutiveFailureCircuitBreakerOptions,
} from "@vetta/runtime-core/kernel";

/** @deprecated Use Runtime Core's general consecutive-failure circuit breaker. */
export type CircuitBreakerOptions = Required<
	Pick<ConsecutiveFailureCircuitBreakerOptions, "maxConsecutiveFailures" | "resetAfterMs">
>;

/** @deprecated Compatibility export; active Coding Agent code uses Runtime Core directly. */
export class CompactionCircuitBreaker extends ConsecutiveFailureCircuitBreaker {
	get consecutiveFailures(): number {
		return this.readSnapshot().consecutiveFailures;
	}

	get isOpen(): boolean {
		return this.readSnapshot().open;
	}
}
