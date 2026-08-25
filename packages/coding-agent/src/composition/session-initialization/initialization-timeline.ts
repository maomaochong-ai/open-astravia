import type { RuntimeAssemblyOperation, RuntimeObservationPublisher } from "@vetta/runtime-core";
import type { CodingAgentSessionInitializationStage } from "../contracts/session-initialization-observability.js";
import { CODING_AGENT_SESSION_INITIALIZATION_OBSERVATION } from "../contracts/session-initialization-observability.js";

export interface CodingAgentSessionInitializationTimeline {
	measure<T>(stage: CodingAgentSessionInitializationStage, operation: () => Promise<T>): Promise<T>;
	measureSync<T>(stage: CodingAgentSessionInitializationStage, operation: () => T): T;
	finish(status: "completed" | "failed"): void;
}

export function createCodingAgentSessionInitializationTimeline(options: {
	readonly sessionId: string;
	readonly operation: RuntimeAssemblyOperation;
	readonly observationPublisher?: RuntimeObservationPublisher;
	readonly now?: () => number;
}): CodingAgentSessionInitializationTimeline {
	const now = options.now ?? (() => performance.now());
	const observations = options.observationPublisher?.scope({ sessionId: options.sessionId });
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
		observations?.record(CODING_AGENT_SESSION_INITIALIZATION_OBSERVATION, {
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
			observations?.record(CODING_AGENT_SESSION_INITIALIZATION_OBSERVATION, {
				operation: options.operation,
				status,
				...(failedStage ? { failedStage } : {}),
				durationMs: Math.max(0, endedAt - startedAt),
				totalDurationMs: Math.max(0, endedAt - startedAt),
			});
		},
	};
}
