import {
	CODING_AGENT_COMPACTION_PREFIRE_OBSERVATION,
	CODING_AGENT_LIFECYCLE_ISSUE_OBSERVATION,
	CODING_AGENT_SUBAGENT_ISSUE_OBSERVATION,
	type CodingAgentCompactionPrefireObservation,
	type CodingAgentLifecycleIssueObservation,
	type CodingAgentSubagentIssueObservation,
} from "@vetta/coding-agent/composition";
import type { RuntimeObservationPort, RuntimeObservationRecord } from "@vetta/runtime-core";

interface CodingAgentObservationLogger {
	info(message: string, fields: Record<string, unknown>): void;
	warn(message: string, fields: Record<string, unknown>): void;
}

/** Projects privacy-safe Coding Context diagnostics from the shared observation hub into Desktop logs. */
export function createCodingAgentObservationLogPort(logger: CodingAgentObservationLogger): RuntimeObservationPort {
	return {
		record(record) {
			if (isLifecycleIssueObservation(record)) {
				logger.warn("coding agent lifecycle issue", {
					operation: record.payload.operation,
					cause: record.payload.cause,
					...(record.context.sessionId ? { sessionId: record.context.sessionId } : {}),
					failureCategory: record.payload.failure.category,
					errorName: record.payload.failure.errorName,
					...(record.payload.failure.errorCode ? { errorCode: record.payload.failure.errorCode } : {}),
				});
				return;
			}
			if (isSubagentIssueObservation(record)) {
				logger.warn("coding subagent issue", {
					operation: record.payload.operation,
					...(record.context.sessionId ? { sessionId: record.context.sessionId } : {}),
					failureCategory: record.payload.failure.category,
					errorName: record.payload.failure.errorName,
					...(record.payload.failure.errorCode ? { errorCode: record.payload.failure.errorCode } : {}),
				});
				return;
			}
			if (!isCompactionPrefireObservation(record)) return;
			const fields = {
				phase: record.payload.phase,
				...(record.context.agentId ? { agentId: record.context.agentId } : {}),
				...(record.context.instanceId ? { instanceId: record.context.instanceId } : {}),
				...(record.context.sessionId ? { sessionId: record.context.sessionId } : {}),
				...(record.payload.tokensBefore === undefined ? {} : { tokensBefore: record.payload.tokensBefore }),
				...(record.payload.failure?.errorName ? { errorName: record.payload.failure.errorName } : {}),
				...(record.payload.failure?.errorCode ? { errorCode: record.payload.failure.errorCode } : {}),
			};
			if (record.payload.phase === "failed") logger.warn("coding context compaction prefire failed", fields);
			else logger.info("coding context compaction prefire", fields);
		},
	};
}

function isLifecycleIssueObservation(
	record: RuntimeObservationRecord,
): record is RuntimeObservationRecord<CodingAgentLifecycleIssueObservation> {
	return record.token.id === CODING_AGENT_LIFECYCLE_ISSUE_OBSERVATION.id;
}

function isSubagentIssueObservation(
	record: RuntimeObservationRecord,
): record is RuntimeObservationRecord<CodingAgentSubagentIssueObservation> {
	return record.token.id === CODING_AGENT_SUBAGENT_ISSUE_OBSERVATION.id;
}

function isCompactionPrefireObservation(
	record: RuntimeObservationRecord,
): record is RuntimeObservationRecord<CodingAgentCompactionPrefireObservation> {
	return record.token.id === CODING_AGENT_COMPACTION_PREFIRE_OBSERVATION.id;
}
