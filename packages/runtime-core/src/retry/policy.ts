import type {
	RuntimeTurnRetryDecision,
	RuntimeTurnRetryDecisionInput,
	RuntimeTurnRetryPolicy,
	RuntimeTurnRetrySettings,
} from "./contracts.js";

export interface ConfigurableRuntimeTurnRetryPolicyOptions {
	readonly readSettings: () => RuntimeTurnRetrySettings;
	readonly setEnabled?: (enabled: boolean) => void;
}

/** Exponential backoff policy that re-reads dynamic settings before every retry. */
export class ConfigurableRuntimeTurnRetryPolicy implements RuntimeTurnRetryPolicy {
	constructor(private readonly options: ConfigurableRuntimeTurnRetryPolicyOptions) {}

	decide(input: RuntimeTurnRetryDecisionInput): RuntimeTurnRetryDecision {
		if (!input.failure.retryable) return { action: "stop", reason: "not-retryable" };
		const settings = this.options.readSettings();
		if (!isValidSettings(settings)) return { action: "stop", reason: "invalid-settings" };
		if (!settings.enabled) return { action: "stop", reason: "disabled" };
		if (input.completedRetries >= settings.maxRetries) {
			return { action: "stop", reason: "attempts-exhausted" };
		}

		const maxDelayMs = settings.maxDelayMs ?? Number.POSITIVE_INFINITY;
		const retryAfterMs = input.failure.details?.retryAfterMs;
		if (retryAfterMs !== undefined && (!Number.isFinite(retryAfterMs) || retryAfterMs < 0)) {
			return { action: "stop", reason: "invalid-settings" };
		}
		if (retryAfterMs !== undefined && retryAfterMs > maxDelayMs) {
			return { action: "stop", reason: "retry-after-exceeds-max-delay" };
		}
		const attempt = input.completedRetries + 1;
		return {
			action: "retry",
			attempt,
			maxAttempts: settings.maxRetries,
			delayMs: Math.min(Math.max(settings.baseDelayMs * 2 ** (attempt - 1), retryAfterMs ?? 0), maxDelayMs),
		};
	}

	setEnabled(enabled: boolean): void {
		this.options.setEnabled?.(enabled);
	}
}

export class NoRetryPolicy implements RuntimeTurnRetryPolicy {
	decide(): RuntimeTurnRetryDecision {
		return { action: "stop", reason: "disabled" };
	}
}

function isValidSettings(settings: RuntimeTurnRetrySettings): boolean {
	return (
		Number.isInteger(settings.maxRetries) &&
		settings.maxRetries >= 0 &&
		Number.isFinite(settings.baseDelayMs) &&
		settings.baseDelayMs >= 0 &&
		(settings.maxDelayMs === undefined || (Number.isFinite(settings.maxDelayMs) && settings.maxDelayMs >= 0))
	);
}
