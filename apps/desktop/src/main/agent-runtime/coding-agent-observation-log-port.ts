import {
	CODING_AGENT_COMPACTION_PREFIRE_OBSERVATION,
	CODING_AGENT_LIFECYCLE_ISSUE_OBSERVATION,
	CODING_AGENT_PLUGIN_CONFIGURATION_OBSERVATION,
	CODING_AGENT_SESSION_ASSISTANCE_OBSERVATION,
	CODING_AGENT_SUBAGENT_ISSUE_OBSERVATION,
	type CodingAgentCompactionPrefireObservation,
	type CodingAgentLifecycleIssueObservation,
	type CodingAgentPluginConfigurationObservation,
	type CodingAgentSessionAssistanceObservation,
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
			if (isSessionAssistanceObservation(record)) {
				const fields = {
					operation: record.payload.operation,
					phase: record.payload.phase,
					...(record.context.sessionId ? { sessionId: record.context.sessionId } : {}),
					...(record.payload.modelProvider ? { modelProvider: record.payload.modelProvider } : {}),
					...(record.payload.modelId ? { modelId: record.payload.modelId } : {}),
					...(record.payload.attempt === undefined ? {} : { attempt: record.payload.attempt }),
					...(record.payload.durationMs === undefined ? {} : { durationMs: record.payload.durationMs }),
					...(record.payload.resultCount === undefined ? {} : { resultCount: record.payload.resultCount }),
					...(record.payload.failure?.errorName ? { errorName: record.payload.failure.errorName } : {}),
					...(record.payload.failure?.errorCode ? { errorCode: record.payload.failure.errorCode } : {}),
				};
				if (
					record.payload.phase === "candidate-empty" ||
					record.payload.phase === "candidate-failed" ||
					record.payload.phase === "exhausted"
				) {
					logger.warn("coding session assistance issue", fields);
				} else {
					logger.info("coding session assistance", fields);
				}
				return;
			}
			if (isPluginConfigurationObservation(record)) {
				const fields = {
					phase: record.payload.phase,
					source: record.payload.source,
					boundary: record.payload.boundary,
					...(record.context.sessionId ? { sessionId: record.context.sessionId } : {}),
					...(record.payload.durationMs === undefined ? {} : { durationMs: record.payload.durationMs }),
					...(record.payload.failure?.errorName ? { errorName: record.payload.failure.errorName } : {}),
					...(record.payload.failure?.errorCode ? { errorCode: record.payload.failure.errorCode } : {}),
				};
				if (record.payload.phase === "failed") {
					logger.warn("coding plugin configuration failed", fields);
				} else if (record.payload.phase === "completed") {
					// started/completed 成对事件对链路没有额外信息；失败仍由 warn 保留。
					logger.info("coding plugin configuration", fields);
				}
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

function isSessionAssistanceObservation(
	record: RuntimeObservationRecord,
): record is RuntimeObservationRecord<CodingAgentSessionAssistanceObservation> {
	return record.token.id === CODING_AGENT_SESSION_ASSISTANCE_OBSERVATION.id;
}

function isPluginConfigurationObservation(
	record: RuntimeObservationRecord,
): record is RuntimeObservationRecord<CodingAgentPluginConfigurationObservation> {
	return record.token.id === CODING_AGENT_PLUGIN_CONFIGURATION_OBSERVATION.id;
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
