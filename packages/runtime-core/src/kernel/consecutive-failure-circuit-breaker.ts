export interface ConsecutiveFailureCircuitBreakerOptions {
	readonly maxConsecutiveFailures?: number;
	readonly resetAfterMs?: number;
	readonly now?: () => number;
}

export interface ConsecutiveFailureCircuitBreakerSnapshot {
	readonly consecutiveFailures: number;
	readonly open: boolean;
	readonly retryAt?: number;
}

const DEFAULT_MAX_CONSECUTIVE_FAILURES = 3;
const DEFAULT_RESET_AFTER_MS = 5 * 60 * 1000;

/** Product-neutral, session-local guard for repeated failures with a deterministic clock boundary. */
export class ConsecutiveFailureCircuitBreaker {
	private readonly maxConsecutiveFailures: number;
	private readonly resetAfterMs: number;
	private readonly now: () => number;
	private failures = 0;
	private lastFailureAt: number | undefined;

	constructor(options: ConsecutiveFailureCircuitBreakerOptions = {}) {
		this.maxConsecutiveFailures = requirePositiveInteger(
			options.maxConsecutiveFailures ?? DEFAULT_MAX_CONSECUTIVE_FAILURES,
			"maxConsecutiveFailures",
		);
		this.resetAfterMs = requireNonNegativeFinite(options.resetAfterMs ?? DEFAULT_RESET_AFTER_MS, "resetAfterMs");
		this.now = options.now ?? Date.now;
	}

	canAttempt(): boolean {
		if (this.failures < this.maxConsecutiveFailures) return true;
		if (this.lastFailureAt !== undefined && this.now() - this.lastFailureAt >= this.resetAfterMs) {
			this.reset();
			return true;
		}
		return false;
	}

	recordSuccess(): void {
		this.reset();
	}

	recordFailure(): void {
		this.failures += 1;
		this.lastFailureAt = this.now();
	}

	reset(): void {
		this.failures = 0;
		this.lastFailureAt = undefined;
	}

	readSnapshot(): ConsecutiveFailureCircuitBreakerSnapshot {
		const open = !this.canAttempt();
		return Object.freeze({
			consecutiveFailures: this.failures,
			open,
			...(open && this.lastFailureAt !== undefined ? { retryAt: this.lastFailureAt + this.resetAfterMs } : {}),
		});
	}
}

function requirePositiveInteger(value: number, name: string): number {
	if (!Number.isInteger(value) || value < 1) throw new Error(`${name} must be a positive integer`);
	return value;
}

function requireNonNegativeFinite(value: number, name: string): number {
	if (!Number.isFinite(value) || value < 0) throw new Error(`${name} must be a non-negative finite number`);
	return value;
}
