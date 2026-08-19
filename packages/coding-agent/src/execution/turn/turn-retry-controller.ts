import { type RuntimeFailure, runtimeFailureFromError } from "@vetta/runtime-core";
import type {
	CodingAgentTurnFailure,
	CodingAgentTurnRetryController,
	CodingAgentTurnRetryControllerOptions,
} from "./contracts.js";

export class CodingAgentSessionTurnRetryController implements CodingAgentTurnRetryController {
	private readonly activeOperations = new Set<AbortController>();
	private retryOwner: AbortController | undefined;
	private attempt = 0;

	constructor(private readonly options: CodingAgentTurnRetryControllerOptions) {}

	get retryAttempt(): number {
		return this.attempt;
	}

	get isRetrying(): boolean {
		return this.attempt > 0;
	}

	setAutoRetryEnabled(enabled: boolean): void {
		this.options.setEnabled(enabled);
	}

	abortRetry(): void {
		for (const operation of this.activeOperations) operation.abort("Retry cancelled");
	}

	async run<T>(
		executeInitial: () => Promise<T>,
		executeRetry: () => Promise<T>,
		readFailure: (result: T) => CodingAgentTurnFailure | undefined,
	): Promise<T> {
		const operation = new AbortController();
		this.activeOperations.add(operation);
		let attempt = 0;
		try {
			let result = await executeInitial();
			let failure = readFailure(result);
			while (failure?.retryable && !operation.signal.aborted) {
				const settings = this.options.readSettings();
				if (!settings.enabled || attempt >= settings.maxRetries) break;
				// Prompt receipts may enter this wrapper while another Turn is still
				// active. They must remain concurrent, but only one failed Turn may own
				// the session-level retry/backoff state at a time.
				if (this.retryOwner && this.retryOwner !== operation) break;
				const retryAfterMs = failure.details?.retryAfterMs;
				const maxDelayMs = settings.maxDelayMs ?? Number.POSITIVE_INFINITY;
				// A provider Retry-After is a minimum, not a suggestion. If the user
				// configured a lower ceiling, stop automatic retries instead of
				// hammering the unavailable endpoint before it asked us to return.
				if (retryAfterMs !== undefined && retryAfterMs > maxDelayMs) break;
				attempt += 1;
				this.retryOwner = operation;
				this.attempt = attempt;
				const delayMs = Math.min(
					Math.max(settings.baseDelayMs * 2 ** (attempt - 1), retryAfterMs ?? 0),
					maxDelayMs,
				);
				this.options.emit({
					type: "auto_retry_start",
					attempt,
					maxAttempts: settings.maxRetries,
					delayMs,
					errorMessage: failure.message,
					failure: toRuntimeFailure(failure),
				});
				if (operation.signal.aborted) return this.finishCancelled(result, attempt);
				try {
					await waitForDelay(delayMs, operation.signal);
					operation.signal.throwIfAborted();
					result = await executeRetry();
				} catch (error) {
					if (operation.signal.aborted) return this.finishCancelled(result, attempt);
					this.emitRetryEnd(false, error, attempt);
					throw error;
				}
				failure = readFailure(result);
			}
			if (operation.signal.aborted) return this.finishCancelled(result, attempt);
			if (attempt > 0) {
				this.options.emit({
					type: "auto_retry_end",
					success: failure === undefined,
					attempt,
					...(failure ? { finalError: failure.message, failure: toRuntimeFailure(failure) } : {}),
				});
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
		if (attempt > 0) this.emitRetryEnd(false, new Error("Retry cancelled"), attempt, "RETRY_CANCELLED");
		return result;
	}

	private emitRetryEnd(success: boolean, error: unknown, attempt: number, code?: string): void {
		this.options.emit({
			type: "auto_retry_end",
			success,
			attempt,
			finalError: error instanceof Error ? error.message : String(error),
			failure: runtimeFailureFromError(error, code ? { code } : undefined),
		});
	}
}

function toRuntimeFailure(failure: CodingAgentTurnFailure): RuntimeFailure {
	return {
		code: failure.code,
		message: failure.message,
		retryable: failure.retryable,
		origin: failure.origin ?? "runtime",
		...(failure.details ? { details: failure.details } : {}),
	};
}

export function createCodingAgentTurnRetryController(
	options: CodingAgentTurnRetryControllerOptions,
): CodingAgentTurnRetryController {
	return new CodingAgentSessionTurnRetryController(options);
}

function waitForDelay(delayMs: number, signal: AbortSignal): Promise<void> {
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
