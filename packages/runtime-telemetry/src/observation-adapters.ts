import type { AgentObservationLevel as RuntimeObservationLevel, AgentTracer as RuntimeTracer } from "@vetta/agent-core";
import type {
	RuntimeObservationLevel as HubObservationLevel,
	RuntimeObservationPort,
	RuntimeObservationRecord,
} from "@vetta/runtime-core/observation";
import type { RuntimeLogger } from "./logger.js";

export interface RuntimeObservationLoggerPortOptions {
	readonly logger: RuntimeLogger;
	/** 领域 Token 的 payload 按 Runtime 安全合同输出；可关闭以只记录信封。默认 true。 */
	readonly includePayload?: boolean;
}

export interface RuntimeObservationTracerPortOptions {
	readonly tracer: RuntimeTracer;
	/** 领域 Token 的 payload 按 Runtime 安全合同写入 metadata；可关闭以只记录信封。默认 true。 */
	readonly includePayload?: boolean;
}

/** 将统一 Observation 信封投影到宿主结构化日志。 */
export function createRuntimeObservationLoggerPort(
	options: RuntimeObservationLoggerPortOptions,
): RuntimeObservationPort {
	return {
		record(record) {
			const context = toLoggerContext(record, options.includePayload !== false);
			const message = `[runtime-observation] ${record.token.id}`;
			switch (record.token.level) {
				case "warning":
					options.logger.warn(message, context);
					return;
				case "error":
					options.logger.error(message, context);
					return;
				default:
					options.logger.info(message, context);
			}
		},
	};
}

/**
 * 将每条统一 Observation 作为一个终结 event 写入既有 AgentTracer。
 * 这是平面事件桥；原生父子 Span 仍由执行层 tracer 创建，context.traceId 会保留在 metadata 中供关联。
 */
export function createRuntimeObservationTracerPort(
	options: RuntimeObservationTracerPortOptions,
): RuntimeObservationPort {
	return {
		record(record) {
			const observation = options.tracer.startObservation(
				record.token.id,
				{
					level: toTracerLevel(record.token.level),
					...(record.context.sessionId ? { sessionId: record.context.sessionId } : {}),
					traceName: record.token.domain,
					metadata: toObservationMetadata(record, options.includePayload !== false),
				},
				{ type: "event" },
			);
			observation.end();
		},
		flush: async () => {
			await options.tracer.flush?.();
		},
	};
}

function toLoggerContext(record: RuntimeObservationRecord, includePayload: boolean) {
	return {
		...(record.context.sessionId ? { sessionId: record.context.sessionId } : {}),
		...(record.context.modelCallId || record.context.turnId || record.context.traceId
			? { requestId: record.context.modelCallId ?? record.context.turnId ?? record.context.traceId }
			: {}),
		...(record.context.toolCallId ? { toolCallId: record.context.toolCallId } : {}),
		meta: toObservationMetadata(record, includePayload),
	};
}

function toObservationMetadata(record: RuntimeObservationRecord, includePayload: boolean): Record<string, unknown> {
	return {
		tokenId: record.token.id,
		domain: record.token.domain,
		event: record.token.event,
		level: record.token.level,
		timestamp: record.timestamp,
		identity: record.context,
		...(includePayload ? { payload: record.payload } : {}),
	};
}

function toTracerLevel(level: HubObservationLevel): RuntimeObservationLevel {
	switch (level) {
		case "debug":
			return "DEBUG";
		case "warning":
			return "WARNING";
		case "error":
			return "ERROR";
		case "info":
			return "DEFAULT";
	}
}
