import {
	RUNTIME_TURN_RETRY_ISSUE_OBSERVATION,
	RUNTIME_TURN_RETRY_LIFECYCLE_OBSERVATION,
	type RuntimeObservationPort,
	type RuntimeObservationRecord,
	type RuntimeTurnRetryIssueObservation,
	type RuntimeTurnRetryLifecycleObservation,
} from "@vetta/runtime-core";

interface RuntimeRetryLogger {
	info(message: string, fields: Record<string, unknown>): void;
	warn(message: string, fields: Record<string, unknown>): void;
}

/** Projects privacy-safe Runtime retry diagnostics into the Desktop text log. */
export function createRuntimeRetryLogPort(logger: RuntimeRetryLogger): RuntimeObservationPort {
	return {
		record(record) {
			if (isRetryLifecycleObservation(record)) {
				logger.info("runtime turn retry", toLifecycleFields(record));
				return;
			}
			if (isRetryIssueObservation(record)) {
				logger.warn("runtime turn retry issue", toIssueFields(record));
			}
		},
	};
}

function isRetryLifecycleObservation(
	record: RuntimeObservationRecord,
): record is RuntimeObservationRecord<RuntimeTurnRetryLifecycleObservation> {
	return record.token.id === RUNTIME_TURN_RETRY_LIFECYCLE_OBSERVATION.id;
}

function isRetryIssueObservation(
	record: RuntimeObservationRecord,
): record is RuntimeObservationRecord<RuntimeTurnRetryIssueObservation> {
	return record.token.id === RUNTIME_TURN_RETRY_ISSUE_OBSERVATION.id;
}

function toLifecycleFields(
	record: RuntimeObservationRecord<RuntimeTurnRetryLifecycleObservation>,
): Record<string, unknown> {
	const { context, payload } = record;
	return {
		phase: payload.phase,
		attempt: payload.attempt,
		...(context.agentId ? { agentId: context.agentId } : {}),
		...(context.instanceId ? { instanceId: context.instanceId } : {}),
		...(context.sessionId ? { sessionId: context.sessionId } : {}),
		...(context.turnId ? { turnId: context.turnId } : {}),
		...(payload.phase === "scheduled"
			? {
					maxAttempts: payload.maxAttempts,
					delayMs: payload.delayMs,
					failureCode: payload.failureCode,
					failureOrigin: payload.failureOrigin,
				}
			: {}),
	};
}

function toIssueFields(record: RuntimeObservationRecord<RuntimeTurnRetryIssueObservation>): Record<string, unknown> {
	const { context, payload } = record;
	return {
		reason: payload.reason,
		attempt: payload.attempt,
		...(context.agentId ? { agentId: context.agentId } : {}),
		...(context.instanceId ? { instanceId: context.instanceId } : {}),
		...(context.sessionId ? { sessionId: context.sessionId } : {}),
		...(context.turnId ? { turnId: context.turnId } : {}),
		...(payload.failureCode ? { failureCode: payload.failureCode } : {}),
		...(payload.failureOrigin ? { failureOrigin: payload.failureOrigin } : {}),
	};
}
