import type { RuntimeFailure } from "../failure-contract.js";
import { runtimeFailureFromError } from "../failure-projection.js";
import type { RuntimeObservationContext, RuntimeObservationPublisher } from "../observation/index.js";
import type {
	RuntimeRetryDelay,
	RuntimeTurnRetryController,
	RuntimeTurnRetryEvent,
	RuntimeTurnRetryPolicy,
	RuntimeTurnRetryStopReason,
} from "./contracts.js";
import { RUNTIME_TURN_RETRY_ISSUE_OBSERVATION, RUNTIME_TURN_RETRY_LIFECYCLE_OBSERVATION } from "./observations.js";

export interface RuntimeTurnRetryCoordinatorOptions {
	readonly policy: RuntimeTurnRetryPolicy;
	readonly emit?: (event: RuntimeTurnRetryEvent) => void;
	readonly observationPublisher?: RuntimeObservationPublisher;
	readonly observationContext?: RuntimeObservationContext;
	readonly delay?: RuntimeRetryDelay;
}

/** Owns the retry operation state for one Session-facing control surface. */
export class RuntimeTurnRetryCoordinator implements RuntimeTurnRetryController {
	private readonly activeOperations = new Set<AbortController>();
	private readonly delay: RuntimeRetryDelay;
	private retryOwner: AbortController | undefined;
	private attempt = 0;

	constructor(private readonly options: RuntimeTurnRetryCoordinatorOptions) {
		this.delay = options.delay ?? new AbortableRuntimeRetryDelay();
	}

	get retryAttempt(): number {
		return this.attempt;
	}

	get isRetrying(): boolean {
		return this.attempt > 0;
	}

	setAutoRetryEnabled(enabled: boolean): void {
		this.options.policy.setEnabled?.(enabled);
	}

	abortRetry(): void {
		for (const operation of this.activeOperations) operation.abort("Retry cancelled");
	}

	async run<T>(
		executeInitial: () => Promise<T>,
		executeRetry: () => Promise<T>,
		readFailure: (result: T) => RuntimeFailure | undefined,
	): Promise<T> {
		const operation = new AbortController();
		this.activeOperations.add(operation);
		let completedRetries = 0;
		try {
			let result = await executeInitial();
			let failure = readFailure(result);
			while (failure && !operation.signal.aborted) {
				const decision = this.options.policy.decide({ failure, completedRetries });
				if (decision.action === "stop") {
					if (failure.retryable && decision.reason !== "disabled") {
						this.recordIssue(decision.reason, completedRetries, failure);
					}
					break;
				}
				if (this.retryOwner && this.retryOwner !== operation) {
					this.recordIssue("concurrent-owner", completedRetries, failure);
					break;
				}

				this.retryOwner = operation;
				this.attempt = decision.attempt;
				this.options.emit?.({
					type: "auto_retry_start",
					attempt: decision.attempt,
					maxAttempts: decision.maxAttempts,
					delayMs: decision.delayMs,
					errorMessage: failure.message,
					failure,
				});
				this.options.observationPublisher?.record(
					RUNTIME_TURN_RETRY_LIFECYCLE_OBSERVATION,
					{
						phase: "scheduled",
						attempt: decision.attempt,
						maxAttempts: decision.maxAttempts,
						delayMs: decision.delayMs,
						failureCode: failure.code,
						failureOrigin: failure.origin,
					},
					this.options.observationContext,
				);
				if (operation.signal.aborted) return this.finishCancelled(result, decision.attempt);
				try {
					await this.delay.wait(decision.delayMs, operation.signal);
					operation.signal.throwIfAborted();
					result = await executeRetry();
					completedRetries = decision.attempt;
				} catch (error) {
					if (operation.signal.aborted) return this.finishCancelled(result, decision.attempt);
					this.recordIssue("retry-execution-failed", decision.attempt);
					this.emitRetryEnd(false, error, decision.attempt);
					throw error;
				}
				failure = readFailure(result);
			}
			if (operation.signal.aborted) return this.finishCancelled(result, completedRetries);
			if (completedRetries > 0) {
				this.options.emit?.({
					type: "auto_retry_end",
					success: failure === undefined,
					attempt: completedRetries,
					...(failure ? { finalError: failure.message, failure } : {}),
				});
				if (!failure) {
					this.options.observationPublisher?.record(
						RUNTIME_TURN_RETRY_LIFECYCLE_OBSERVATION,
						{ phase: "completed", attempt: completedRetries },
						this.options.observationContext,
					);
				}
			}
			return result;
		} finally {
			this.activeOperations.delete(operation);
			if (this.retryOwner === operation) {
				this.retryOwner = undefined;
				this.attempt = 0;
			}
		}
	}

	private finishCancelled<T>(result: T, attempt: number): T {
		if (attempt > 0) {
			this.emitRetryEnd(false, new Error("Retry cancelled"), attempt, "RETRY_CANCELLED");
			this.options.observationPublisher?.record(
				RUNTIME_TURN_RETRY_LIFECYCLE_OBSERVATION,
				{ phase: "cancelled", attempt },
				this.options.observationContext,
			);
		}
		return result;
	}

	private emitRetryEnd(success: boolean, error: unknown, attempt: number, code?: string): void {
		this.options.emit?.({
			type: "auto_retry_end",
			success,
			attempt,
			finalError: error instanceof Error ? error.message : String(error),
			failure: runtimeFailureFromError(error, code ? { code } : undefined),
		});
	}

	private recordIssue(reason: Parameters<typeof issuePayload>[0], attempt: number, failure?: RuntimeFailure): void {
		this.options.observationPublisher?.record(
			RUNTIME_TURN_RETRY_ISSUE_OBSERVATION,
			issuePayload(reason, attempt, failure),
			this.options.observationContext,
		);
	}
}

export class AbortableRuntimeRetryDelay implements RuntimeRetryDelay {
	wait(delayMs: number, signal: AbortSignal): Promise<void> {
		return new Promise((resolve, reject) => {
			if (signal.aborted) {
				reject(signal.reason);
				return;
			}
			const handleAbort = (): void => {
				clearTimeout(timeout);
				signal.removeEventListener("abort", handleAbort);
				reject(signal.reason);
			};
			const timeout = setTimeout(() => {
				signal.removeEventListener("abort", handleAbort);
				resolve();
			}, delayMs);
			signal.addEventListener("abort", handleAbort, { once: true });
		});
	}
}

function issuePayload(
	reason: "concurrent-owner" | "retry-execution-failed" | RuntimeTurnRetryStopReason,
	attempt: number,
	failure?: RuntimeFailure,
) {
	return {
		reason,
		attempt,
		...(failure ? { failureCode: failure.code, failureOrigin: failure.origin } : {}),
	};
}
