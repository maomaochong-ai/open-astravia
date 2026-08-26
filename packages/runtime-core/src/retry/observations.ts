import type { RuntimeFailureOrigin } from "../failure-contract.js";
import { defineRuntimeObservation } from "../observation/index.js";
import type { RuntimeTurnRetryStopReason } from "./contracts.js";

export type RuntimeTurnRetryLifecycleObservation =
	| {
			readonly phase: "scheduled";
			readonly attempt: number;
			readonly maxAttempts: number;
			readonly delayMs: number;
			readonly failureCode: string;
			readonly failureOrigin: RuntimeFailureOrigin;
	  }
	| { readonly phase: "completed"; readonly attempt: number }
	| { readonly phase: "cancelled"; readonly attempt: number };

export interface RuntimeTurnRetryIssueObservation {
	readonly reason: RuntimeTurnRetryStopReason | "concurrent-owner" | "retry-execution-failed";
	readonly attempt: number;
	readonly failureCode?: string;
	readonly failureOrigin?: RuntimeFailureOrigin;
}

export const RUNTIME_TURN_RETRY_LIFECYCLE_OBSERVATION = defineRuntimeObservation<RuntimeTurnRetryLifecycleObservation>(
	"runtime.retry",
	"lifecycle",
);

export const RUNTIME_TURN_RETRY_ISSUE_OBSERVATION = defineRuntimeObservation<RuntimeTurnRetryIssueObservation>(
	"runtime.retry",
	"issue",
	"warning",
);
