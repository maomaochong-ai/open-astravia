/**
 * Circuit breaker for compaction retries.
 *
 * After N consecutive LLM compaction failures the breaker "opens" and
 * skips further attempts for a cooldown period.  This prevents wasting
 * API calls when the context is in an unrecoverable state (e.g. the
 * compaction request itself triggers prompt-too-long).
 */

export interface CircuitBreakerOptions {
	/** Failures before the breaker opens. */
	maxConsecutiveFailures: number;
	/** Auto-reset after this many ms (allows retry after cooldown). */
	resetAfterMs: number;
}

const DEFAULT_OPTIONS: CircuitBreakerOptions = {
	maxConsecutiveFailures: 3,
	resetAfterMs: 5 * 60 * 1000, // 5 minutes
};

export class CompactionCircuitBreaker {
	private _failures = 0;
	private _lastFailureTime = 0;
	private readonly _options: CircuitBreakerOptions;

	constructor(options?: Partial<CircuitBreakerOptions>) {
		this._options = { ...DEFAULT_OPTIONS, ...options };
	}

	/** Whether a compaction attempt is allowed. */
	canAttempt(): boolean {
		if (this._failures < this._options.maxConsecutiveFailures) return true;
		// Auto-reset after cooldown
		if (Date.now() - this._lastFailureTime >= this._options.resetAfterMs) {
			this.reset();
			return true;
		}
		return false;
	}

	recordSuccess(): void {
		this._failures = 0;
	}

	recordFailure(): void {
		this._failures++;
		this._lastFailureTime = Date.now();
	}

	reset(): void {
		this._failures = 0;
		this._lastFailureTime = 0;
	}

	get consecutiveFailures(): number {
		return this._failures;
	}

	get isOpen(): boolean {
		return !this.canAttempt();
	}
}
