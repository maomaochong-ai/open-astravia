import type {
	CodingAgentSessionInitializationObservation,
	CodingAgentSessionInitializationObserver,
} from "@vetta/coding-agent/composition";

interface SessionInitializationLogger {
	info(message: string, fields: Record<string, unknown>): void;
	warn(message: string, fields: Record<string, unknown>): void;
}

interface PendingInitializationTrace {
	readonly stages: Record<string, { durationMs: number; status: "completed" | "failed" }>;
}

/** Aggregate noisy phase completions into one privacy-safe log entry per Session initialization. */
export function createSessionInitializationLogObserver(
	logger: SessionInitializationLogger,
): CodingAgentSessionInitializationObserver {
	const pending = new Map<string, PendingInitializationTrace>();

	return (observation) => {
		if (observation.status === "stage-completed" || observation.status === "stage-failed") {
			if (!observation.stage) return;
			const trace = pending.get(observation.sessionId) ?? { stages: {} };
			trace.stages[observation.stage] = {
				durationMs: roundDuration(observation.durationMs),
				status: observation.status === "stage-completed" ? "completed" : "failed",
			};
			pending.set(observation.sessionId, trace);
			return;
		}

		const trace = pending.get(observation.sessionId) ?? { stages: {} };
		pending.delete(observation.sessionId);
		const fields = toLogFields(observation, trace);
		if (observation.status === "completed") {
			logger.info("session initialization trace", fields);
		} else {
			logger.warn("session initialization trace", fields);
		}
	};
}

function toLogFields(
	observation: CodingAgentSessionInitializationObservation,
	trace: PendingInitializationTrace,
): Record<string, unknown> {
	return {
		sessionId: observation.sessionId,
		operation: observation.operation,
		status: observation.status,
		totalDurationMs: roundDuration(observation.totalDurationMs),
		...(observation.failedStage ? { failedStage: observation.failedStage } : {}),
		stages: trace.stages,
	};
}

function roundDuration(value: number): number {
	return Math.round(value * 10) / 10;
}
