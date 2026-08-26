import type { RuntimeFailure } from "../failure-contract.js";

export interface RuntimeTurnRetrySettings {
	readonly enabled: boolean;
	readonly maxRetries: number;
	readonly baseDelayMs: number;
	readonly maxDelayMs?: number;
}

export type RuntimeTurnRetryStopReason =
	| "disabled"
	| "not-retryable"
	| "attempts-exhausted"
	| "retry-after-exceeds-max-delay"
	| "invalid-settings";

export type RuntimeTurnRetryDecision =
	| {
			readonly action: "retry";
			readonly attempt: number;
			readonly maxAttempts: number;
			readonly delayMs: number;
	  }
	| { readonly action: "stop"; readonly reason: RuntimeTurnRetryStopReason };

export interface RuntimeTurnRetryDecisionInput {
	readonly failure: RuntimeFailure;
	readonly completedRetries: number;
}

/** Product-neutral variation point for retry eligibility and delay calculation. */
export interface RuntimeTurnRetryPolicy {
	decide(input: RuntimeTurnRetryDecisionInput): RuntimeTurnRetryDecision;
	setEnabled?(enabled: boolean): void;
}

export type RuntimeTurnRetryEvent =
	| {
			readonly type: "auto_retry_start";
			readonly attempt: number;
			readonly maxAttempts: number;
			readonly delayMs: number;
			readonly errorMessage: string;
			readonly failure?: RuntimeFailure;
	  }
	| {
			readonly type: "auto_retry_end";
			readonly success: boolean;
			readonly attempt: number;
			readonly finalError?: string;
			readonly failure?: RuntimeFailure;
	  };

export interface RuntimeTurnRetryController {
	readonly retryAttempt: number;
	readonly isRetrying: boolean;
	setAutoRetryEnabled(enabled: boolean): void;
	abortRetry(): void;
	run<T>(
		executeInitial: () => Promise<T>,
		executeRetry: () => Promise<T>,
		readFailure: (result: T) => RuntimeFailure | undefined,
	): Promise<T>;
}

export interface RuntimeRetryDelay {
	wait(delayMs: number, signal: AbortSignal): Promise<void>;
}
