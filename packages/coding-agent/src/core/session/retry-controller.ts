/**
 * Auto-retry controller — retries retryable LLM errors with exponential backoff.
 *
 * Extracted from AgentSession. Owns the retry abort controller, attempt counter,
 * and the promise that prompt() awaits so a turn doesn't resolve mid-retry.
 */

import type { AssistantMessage } from "@vetta/ai";
import { isContextOverflow } from "@vetta/ai";
import { sleep } from "../../utils/sleep.js";
import type { SessionContext } from "./session-context.js";

export class RetryController {
	private _retryAbortController: AbortController | undefined = undefined;
	private _retryAttempt = 0;
	private _retryPromise: Promise<void> | undefined = undefined;
	private _retryResolve: (() => void) | undefined = undefined;

	constructor(private readonly ctx: SessionContext) {}

	get retryAttempt(): number {
		return this._retryAttempt;
	}

	/** Whether auto-retry is currently in progress. */
	get isRetrying(): boolean {
		return this._retryPromise !== undefined;
	}

	/** Resolve the pending retry promise. */
	private resolveRetry(): void {
		if (this._retryResolve) {
			this._retryResolve();
			this._retryResolve = undefined;
			this._retryPromise = undefined;
		}
	}

	/**
	 * Called on a successful assistant response: reset the retry counter and
	 * resolve any pending retry so a multi-call turn doesn't accumulate attempts.
	 */
	notifySuccess(): void {
		if (this._retryAttempt > 0) {
			this.ctx.emit({ type: "auto_retry_end", success: true, attempt: this._retryAttempt });
			this._retryAttempt = 0;
			this.resolveRetry();
		}
	}

	/**
	 * Check if an error is retryable (overloaded, rate limit, server errors).
	 * Context overflow errors are NOT retryable (handled by compaction instead).
	 * Plan/quota exhaustion errors are NOT retryable either: their reset time is
	 * hours away, so retrying within the backoff window just spams identical errors.
	 */
	isRetryableError(message: AssistantMessage): boolean {
		if (message.stopReason !== "error" || !message.errorMessage) return false;

		// Context overflow is handled by compaction, not retry
		const contextWindow = this.ctx.model?.contextWindow ?? 0;
		if (isContextOverflow(message, contextWindow)) return false;

		const err = message.errorMessage;

		// Plan/quota exhaustion (e.g. "429 Token Plan 5h 窗口额度已用尽，将于 ... 重置",
		// "insufficient quota"). These won't recover within the retry backoff window,
		// so treat them as non-retryable and surface a single error to the user.
		if (
			/额度已用尽|额度不足|窗口额度|余额不足|Token Plan|insufficient.?quota|insufficient.?balance|quota.?exhausted|quota.?exceeded|out of quota|exceeded your current quota/i.test(
				err,
			)
		) {
			return false;
		}

		// Match: overloaded_error, rate limit, 429, 500, 502, 503, 504, service unavailable, connection errors, fetch failed, terminated, retry delay exceeded
		// Node 抛的连接错误原文是 `connect ECONNREFUSED 1.2.3.4:443` / `getaddrinfo
		// EAI_AGAIN ...`，不含 "connection refused" 这类英文短语，所以 errno 必须
		// 单独列——只匹配短语会让真正的断网/连不上一次都不重试。
		return /overloaded|rate.?limit|too many requests|429|500|502|503|504|service.?unavailable|server error|internal error|connection.?error|connection.?refused|other side closed|fetch failed|upstream.?connect|reset before headers|terminated|retry delay|ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|EPIPE|EHOSTUNREACH|ENETUNREACH/i.test(
			err,
		);
	}

	/**
	 * Handle retryable errors with exponential backoff.
	 * @returns true if retry was initiated, false if max retries exceeded or disabled
	 */
	async handleRetryableError(message: AssistantMessage): Promise<boolean> {
		const settings = this.ctx.settingsManager.getRetrySettings();
		if (!settings.enabled) return false;

		this._retryAttempt++;

		// Create retry promise on first attempt so waitForRetry() can await it
		if (this._retryAttempt === 1 && !this._retryPromise) {
			this._retryPromise = new Promise((resolve) => {
				this._retryResolve = resolve;
			});
		}

		if (this._retryAttempt > settings.maxRetries) {
			// Max retries exceeded, emit final failure and reset
			this.ctx.emit({
				type: "auto_retry_end",
				success: false,
				attempt: this._retryAttempt - 1,
				finalError: message.errorMessage,
			});
			this._retryAttempt = 0;
			this.resolveRetry(); // Resolve so waitForRetry() completes
			return false;
		}

		const delayMs = settings.baseDelayMs * 2 ** (this._retryAttempt - 1);

		this.ctx.emit({
			type: "auto_retry_start",
			attempt: this._retryAttempt,
			maxAttempts: settings.maxRetries,
			delayMs,
			errorMessage: message.errorMessage || "Unknown error",
		});

		// Remove error message from agent state (keep in session for history)
		const messages = this.ctx.agent.state.messages;
		if (messages.length > 0 && messages[messages.length - 1].role === "assistant") {
			this.ctx.agent.replaceMessages(messages.slice(0, -1));
		}

		// Wait with exponential backoff (abortable)
		this._retryAbortController = new AbortController();
		try {
			await sleep(delayMs, this._retryAbortController.signal);
		} catch {
			// Aborted during sleep - emit end event so UI can clean up
			const attempt = this._retryAttempt;
			this._retryAttempt = 0;
			this._retryAbortController = undefined;
			this.ctx.emit({
				type: "auto_retry_end",
				success: false,
				attempt,
				finalError: "Retry cancelled",
			});
			this.resolveRetry();
			return false;
		}
		this._retryAbortController = undefined;

		// Retry via continue() - use setTimeout to break out of event handler chain
		setTimeout(() => {
			this.ctx.agent.continue().catch(() => {
				// Retry failed - will be caught by next agent_end
			});
		}, 0);

		return true;
	}

	/** Cancel in-progress retry. */
	abortRetry(): void {
		this._retryAbortController?.abort();
		// Note: _retryAttempt is reset in the catch block of handleRetryableError
		this.resolveRetry();
	}

	/**
	 * Wait for any in-progress retry to complete.
	 * Returns immediately if no retry is in progress.
	 */
	async waitForRetry(): Promise<void> {
		if (this._retryPromise) {
			await this._retryPromise;
		}
	}
}
