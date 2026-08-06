export interface CodingAgentGreenfieldTurnRetrySettings {
	readonly enabled: boolean;
	readonly maxRetries: number;
	readonly baseDelayMs: number;
	readonly maxDelayMs?: number;
}

export type CodingAgentGreenfieldTurnRetryEvent =
	| {
			readonly type: "auto_retry_start";
			readonly attempt: number;
			readonly maxAttempts: number;
			readonly delayMs: number;
			readonly errorMessage: string;
	  }
	| {
			readonly type: "auto_retry_end";
			readonly success: boolean;
			readonly attempt: number;
			readonly finalError?: string;
	  };

export interface CodingAgentGreenfieldTurnRetryControllerOptions {
	readonly readSettings: () => CodingAgentGreenfieldTurnRetrySettings;
	readonly setEnabled: (enabled: boolean) => void;
	readonly emit: (event: CodingAgentGreenfieldTurnRetryEvent) => void;
}

export interface CodingAgentGreenfieldTurnRetryControllerPort {
	readonly retryAttempt: number;
	readonly isRetrying: boolean;
	setAutoRetryEnabled(enabled: boolean): void;
	abortRetry(): void;
	run<T>(
		executeInitial: () => Promise<T>,
		executeRetry: () => Promise<T>,
		readFailure: (result: T) => string | undefined,
	): Promise<T>;
}

/** Greenfield Turn 级重试编排；不依赖 RPC transport 或具体 Session 实现。 */
export class CodingAgentGreenfieldTurnRetryController implements CodingAgentGreenfieldTurnRetryControllerPort {
	private abortController: AbortController | undefined;
	private attempt = 0;

	constructor(private readonly options: CodingAgentGreenfieldTurnRetryControllerOptions) {}

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
		this.abortController?.abort();
	}

	async run<T>(
		executeInitial: () => Promise<T>,
		executeRetry: () => Promise<T>,
		readFailure: (result: T) => string | undefined,
	): Promise<T> {
		let result = await executeInitial();
		let failure = readFailure(result);
		while (failure && isRetryableError(failure)) {
			const settings = this.options.readSettings();
			if (!settings.enabled || this.attempt >= settings.maxRetries) break;
			this.attempt += 1;
			const delayMs = Math.min(
				settings.baseDelayMs * 2 ** (this.attempt - 1),
				settings.maxDelayMs ?? Number.POSITIVE_INFINITY,
			);
			this.options.emit({
				type: "auto_retry_start",
				attempt: this.attempt,
				maxAttempts: settings.maxRetries,
				delayMs,
				errorMessage: failure,
			});
			this.abortController = new AbortController();
			try {
				await waitForDelay(delayMs, this.abortController.signal);
			} catch {
				this.options.emit({
					type: "auto_retry_end",
					success: false,
					attempt: this.attempt,
					finalError: "Retry cancelled",
				});
				this.attempt = 0;
				return result;
			} finally {
				this.abortController = undefined;
			}
			try {
				result = await executeRetry();
			} catch (error) {
				this.options.emit({
					type: "auto_retry_end",
					success: false,
					attempt: this.attempt,
					finalError: error instanceof Error ? error.message : String(error),
				});
				this.attempt = 0;
				throw error;
			}
			failure = readFailure(result);
		}
		if (this.attempt > 0) {
			this.options.emit({
				type: "auto_retry_end",
				success: failure === undefined,
				attempt: this.attempt,
				...(failure ? { finalError: failure } : {}),
			});
			this.attempt = 0;
		}
		return result;
	}
}

function isRetryableError(message: string): boolean {
	if (
		/额度已用尽|额度不足|窗口额度|余额不足|Token Plan|insufficient.?quota|insufficient.?balance|quota.?exhausted|quota.?exceeded|out of quota|exceeded your current quota/i.test(
			message,
		)
	) {
		return false;
	}
	return /overloaded|rate.?limit|too many requests|429|500|502|503|504|service.?unavailable|server error|internal error|connection.?error|connection.?refused|ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|EPIPE|EHOSTUNREACH|ENETUNREACH|other side closed|fetch failed|upstream.?connect|reset before headers|terminated|retry delay/i.test(
		message,
	);
}

function waitForDelay(delayMs: number, signal: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		if (signal.aborted) {
			reject(signal.reason);
			return;
		}
		const timeout = setTimeout(resolve, delayMs);
		signal.addEventListener(
			"abort",
			() => {
				clearTimeout(timeout);
				reject(signal.reason);
			},
			{ once: true },
		);
	});
}
