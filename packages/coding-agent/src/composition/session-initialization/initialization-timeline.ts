import type { RuntimeAssemblyOperation } from "@vetta/runtime-core";
import type {
	CodingAgentSessionInitializationObservation,
	CodingAgentSessionInitializationObserver,
	CodingAgentSessionInitializationStage,
} from "../contracts/session-initialization-observability.js";

export interface CodingAgentSessionInitializationTimeline {
	measure<T>(stage: CodingAgentSessionInitializationStage, operation: () => Promise<T>): Promise<T>;
	measureSync<T>(stage: CodingAgentSessionInitializationStage, operation: () => T): T;
	finish(status: "completed" | "failed"): void;
}

export function createCodingAgentSessionInitializationTimeline(options: {
	readonly sessionId: string;
	readonly operation: RuntimeAssemblyOperation;
	readonly observer?: CodingAgentSessionInitializationObserver;
	readonly now?: () => number;
}): CodingAgentSessionInitializationTimeline {
	const now = options.now ?? (() => performance.now());
	const startedAt = now();
	let failedStage: CodingAgentSessionInitializationStage | undefined;
	let finished = false;

	const reportStage = (
		stage: CodingAgentSessionInitializationStage,
		status: "stage-completed" | "stage-failed",
		stageStartedAt: number,
	): void => {
		const endedAt = now();
		if (status === "stage-failed") failedStage = stage;
		safelyObserve(options.observer, {
			sessionId: options.sessionId,
			operation: options.operation,
			status,
			stage,
			durationMs: Math.max(0, endedAt - stageStartedAt),
			totalDurationMs: Math.max(0, endedAt - startedAt),
		});
	};

	return {
		async measure(stage, operation) {
			const stageStartedAt = now();
			try {
				const result = await operation();
				reportStage(stage, "stage-completed", stageStartedAt);
				return result;
			} catch (error) {
				reportStage(stage, "stage-failed", stageStartedAt);
				throw error;
			}
		},
		measureSync(stage, operation) {
			const stageStartedAt = now();
			try {
				const result = operation();
				reportStage(stage, "stage-completed", stageStartedAt);
				return result;
			} catch (error) {
				reportStage(stage, "stage-failed", stageStartedAt);
				throw error;
			}
		},
		finish(status) {
			if (finished) return;
			finished = true;
			const endedAt = now();
			safelyObserve(options.observer, {
				sessionId: options.sessionId,
				operation: options.operation,
				status,
				...(failedStage ? { failedStage } : {}),
				durationMs: Math.max(0, endedAt - startedAt),
				totalDurationMs: Math.max(0, endedAt - startedAt),
			});
		},
	};
}

function safelyObserve(
	observer: CodingAgentSessionInitializationObserver | undefined,
	observation: CodingAgentSessionInitializationObservation,
): void {
	try {
		observer?.(observation);
	} catch {
		// Observability must never change Session initialization behavior.
	}
}
