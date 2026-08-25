import {
	RUNTIME_AGENT_LIFECYCLE_OBSERVATION,
	type RuntimeAgentLifecycleObservation,
	type RuntimeObservationPort,
	type RuntimeObservationRecord,
} from "@vetta/runtime-core";

interface RuntimeAgentLifecycleLogger {
	info(message: string, fields: Record<string, unknown>): void;
	warn(message: string, fields: Record<string, unknown>): void;
}

const LOGGED_CONTROL_PLANE_OPERATIONS = new Set<RuntimeAgentLifecycleObservation["operation"]>([
	"revision.publish",
	"revision.retire",
	"revision.remove",
	"session.rebind",
]);

/**
 * 将 Runtime Agent 的关键控制面事件映射到 Desktop 日志。
 * 这里只记录 identity、revision 和分类后的失败，不记录 Prompt、Tool 参数/结果或原始错误文本。
 */
export function createRuntimeAgentLifecycleLogPort(logger: RuntimeAgentLifecycleLogger): RuntimeObservationPort {
	return {
		record(record) {
			if (!isRuntimeAgentLifecycleObservation(record)) return;
			const observation = record.payload;
			if (observation.phase === "failed") {
				logger.warn("runtime agent lifecycle failure", toLogFields(record));
				return;
			}
			if (observation.phase === "completed" && LOGGED_CONTROL_PLANE_OPERATIONS.has(observation.operation)) {
				logger.info("runtime agent lifecycle", toLogFields(record));
			}
		},
	};
}

function isRuntimeAgentLifecycleObservation(
	record: RuntimeObservationRecord,
): record is RuntimeObservationRecord<RuntimeAgentLifecycleObservation> {
	return record.token === RUNTIME_AGENT_LIFECYCLE_OBSERVATION;
}

function toLogFields(record: RuntimeObservationRecord<RuntimeAgentLifecycleObservation>): Record<string, unknown> {
	const { context, payload } = record;
	return {
		operation: payload.operation,
		phase: payload.phase,
		...(context.agentId ? { agentId: context.agentId } : {}),
		...(context.revisionId ? { revisionId: context.revisionId } : {}),
		...(context.instanceId ? { instanceId: context.instanceId } : {}),
		...(context.sessionId ? { sessionId: context.sessionId } : {}),
		...(payload.sourceId ? { sourceId: payload.sourceId } : {}),
		...(payload.sourceRevision ? { sourceRevision: payload.sourceRevision } : {}),
		...(payload.definitionCount !== undefined ? { definitionCount: payload.definitionCount } : {}),
		...(payload.removedCount !== undefined ? { removedCount: payload.removedCount } : {}),
		...(payload.failure
			? {
					failureCategory: payload.failure.category,
					errorName: payload.failure.errorName,
					...(payload.failure.errorCode ? { errorCode: payload.failure.errorCode } : {}),
				}
			: {}),
	};
}
