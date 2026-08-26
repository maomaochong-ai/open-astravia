import {
	RUNTIME_AGENT_LIFECYCLE_OBSERVATION,
	RUNTIME_HOST_LIFECYCLE_OBSERVATION,
	type RuntimeAgentLifecycleObservation,
	type RuntimeHostLifecycleObservation,
	type RuntimeObservationPort,
	type RuntimeObservationRecord,
} from "@vetta/runtime-core";

interface RuntimeLifecycleLogger {
	info(message: string, fields: Record<string, unknown>): void;
	warn(message: string, fields: Record<string, unknown>): void;
}

const LOGGED_CONTROL_PLANE_OPERATIONS = new Set<RuntimeAgentLifecycleObservation["operation"]>([
	"revision.publish",
	"revision.retire",
	"revision.remove",
	"instance.pool.retire",
	"session.rebind",
]);

/**
 * 将 Runtime Host 与 Agent 控制面的关键生命周期事件映射到 Desktop 日志。
 * 这里只记录 identity、revision 和分类后的失败，不记录 Prompt、Tool 参数/结果或原始错误文本。
 */
export function createRuntimeLifecycleLogPort(logger: RuntimeLifecycleLogger): RuntimeObservationPort {
	return {
		record(record) {
			if (isRuntimeAgentLifecycleObservation(record)) {
				const observation = record.payload;
				if (observation.phase === "failed") {
					logger.warn("runtime agent lifecycle failure", toAgentLogFields(record));
					return;
				}
				if (observation.phase === "completed" && LOGGED_CONTROL_PLANE_OPERATIONS.has(observation.operation)) {
					logger.info("runtime agent lifecycle", toAgentLogFields(record));
				}
				return;
			}
			if (!isRuntimeHostLifecycleObservation(record)) return;
			if (record.payload.phase === "failed") {
				logger.warn("runtime host lifecycle failure", toHostLogFields(record));
				return;
			}
			if (record.payload.operation === "host.close" && record.payload.phase === "completed") {
				logger.info("runtime host lifecycle", toHostLogFields(record));
			}
		},
	};
}

function isRuntimeAgentLifecycleObservation(
	record: RuntimeObservationRecord,
): record is RuntimeObservationRecord<RuntimeAgentLifecycleObservation> {
	return record.token.id === RUNTIME_AGENT_LIFECYCLE_OBSERVATION.id;
}

function isRuntimeHostLifecycleObservation(
	record: RuntimeObservationRecord,
): record is RuntimeObservationRecord<RuntimeHostLifecycleObservation> {
	return record.token.id === RUNTIME_HOST_LIFECYCLE_OBSERVATION.id;
}

function toAgentLogFields(record: RuntimeObservationRecord<RuntimeAgentLifecycleObservation>): Record<string, unknown> {
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
		...(payload.reason ? { reason: payload.reason } : {}),
		...(payload.failure
			? {
					failureCategory: payload.failure.category,
					errorName: payload.failure.errorName,
					...(payload.failure.errorCode ? { errorCode: payload.failure.errorCode } : {}),
				}
			: {}),
	};
}

function toHostLogFields(record: RuntimeObservationRecord<RuntimeHostLifecycleObservation>): Record<string, unknown> {
	const { context, payload } = record;
	return {
		operation: payload.operation,
		phase: payload.phase,
		...(payload.component ? { component: payload.component } : {}),
		...(context.sessionId ? { sessionId: context.sessionId } : {}),
		...(payload.failure
			? {
					failureCategory: payload.failure.category,
					errorName: payload.failure.errorName,
					...(payload.failure.errorCode ? { errorCode: payload.failure.errorCode } : {}),
				}
			: {}),
	};
}
