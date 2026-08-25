import {
	CODING_AGENT_SESSION_INITIALIZATION_OBSERVATION,
	type CodingAgentSessionInitializationObservation,
} from "@vetta/coding-agent/composition";
import type { RuntimeObservationPort, RuntimeObservationRecord } from "@vetta/runtime-core";

interface SessionInitializationLogger {
	info(message: string, fields: Record<string, unknown>): void;
	warn(message: string, fields: Record<string, unknown>): void;
}

interface PendingInitializationTrace {
	readonly stages: Record<string, { durationMs: number; status: "completed" | "failed" }>;
}

/** Aggregate noisy phase observations into one privacy-safe log entry per Session initialization. */
export function createSessionInitializationLogPort(logger: SessionInitializationLogger): RuntimeObservationPort {
	const pending = new Map<string, PendingInitializationTrace>();

	return {
		record(record) {
			if (!isSessionInitializationObservation(record)) return;
			const sessionId = record.context.sessionId;
			if (!sessionId) return;
			const observation = record.payload;
			if (observation.status === "stage-completed" || observation.status === "stage-failed") {
				if (!observation.stage) return;
				const trace = pending.get(sessionId) ?? { stages: {} };
				trace.stages[observation.stage] = {
					durationMs: roundDuration(observation.durationMs),
					status: observation.status === "stage-completed" ? "completed" : "failed",
				};
				pending.set(sessionId, trace);
				return;
			}

			const trace = pending.get(sessionId) ?? { stages: {} };
			pending.delete(sessionId);
			const fields = toLogFields(sessionId, observation, trace);
			if (observation.status === "completed") {
				logger.info("session initialization trace", fields);
			} else {
				logger.warn("session initialization trace", fields);
			}
		},
	};
}

function isSessionInitializationObservation(
	record: RuntimeObservationRecord,
): record is RuntimeObservationRecord<CodingAgentSessionInitializationObservation> {
	return record.token === CODING_AGENT_SESSION_INITIALIZATION_OBSERVATION;
}

function toLogFields(
	sessionId: string,
	observation: CodingAgentSessionInitializationObservation,
	trace: PendingInitializationTrace,
): Record<string, unknown> {
	return {
		sessionId,
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
