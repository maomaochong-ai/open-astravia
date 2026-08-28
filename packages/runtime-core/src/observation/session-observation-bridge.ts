import type { RuntimeEventSource } from "../contracts.js";
import type { RuntimeFailure } from "../failure-contract.js";
import type { RuntimeSessionObservationEvent } from "../session-observation.js";
import type { RuntimeObservationContext, RuntimeObservationPublisher } from "./contracts.js";
import { defineRuntimeObservation } from "./observation.js";

export interface RuntimeSessionObservationSafeFailure {
	readonly code: string;
	readonly origin: RuntimeFailure["origin"];
	readonly retryable: boolean;
}

/**
 * Session 业务事件的内容安全投影。这里刻意只允许结构、计数、耗时和稳定失败字段，
 * 不携带消息、Thinking、Tool 参数/结果、路径、命令、扩展 payload 或错误正文。
 */
export interface RuntimeSessionObservationSummary {
	readonly eventType: RuntimeSessionObservationEvent["type"];
	readonly source: RuntimeEventSource;
	readonly phase?: string;
	readonly status?: string;
	readonly role?: string;
	readonly characterCount?: number;
	readonly fieldCount?: number;
	readonly toolName?: string;
	readonly startedAt?: number;
	readonly atMs?: number;
	readonly durationMs?: number;
	readonly phaseCount?: number;
	readonly changed?: boolean;
	readonly success?: boolean;
	readonly isError?: boolean;
	readonly attempt?: number;
	readonly maxAttempts?: number;
	readonly delayMs?: number;
	readonly count?: number;
	readonly countsByStatus?: Readonly<Record<string, number>>;
	readonly input?: number;
	readonly output?: number;
	readonly cacheRead?: number;
	readonly cacheWrite?: number;
	readonly costTotal?: number;
	readonly contextPercent?: number | null;
	readonly contextTokens?: number | null;
	readonly contextWindow?: number;
	readonly modelApi?: string;
	readonly modelProvider?: string;
	readonly modelId?: string;
	readonly extensionId?: string;
	readonly extensionEvent?: string;
	readonly reason?: string;
	readonly tokensBefore?: number;
	readonly thresholdTokens?: number;
	readonly failure?: RuntimeSessionObservationSafeFailure;
}

export const RUNTIME_SESSION_OBSERVATION_SUMMARY = defineRuntimeObservation<RuntimeSessionObservationSummary>(
	"runtime.session",
	"event",
);

/** 将既有 Session 事件显式投影到统一 Hub；Publisher 失败隔离语义保持不变。 */
export function publishRuntimeSessionObservation(
	publisher: RuntimeObservationPublisher | undefined,
	event: RuntimeSessionObservationEvent,
	context: RuntimeObservationContext = {},
): void {
	if (!publisher) return;
	publisher.record(RUNTIME_SESSION_OBSERVATION_SUMMARY, projectRuntimeSessionObservation(event), {
		...context,
		...(readTurnId(event) ? { turnId: readTurnId(event) } : {}),
		...(readToolCallId(event) ? { toolCallId: readToolCallId(event) } : {}),
	});
}

export function projectRuntimeSessionObservation(
	event: RuntimeSessionObservationEvent,
): RuntimeSessionObservationSummary {
	const base = { eventType: event.type, source: event.source } as const;
	switch (event.type) {
		case "lifecycle":
			return { ...base, phase: event.phase };
		case "message.delta":
		case "thinking.delta":
			return { ...base, characterCount: event.delta.length };
		case "message.final":
			return { ...base, role: event.message.role };
		case "toolcall.start":
			return { ...base, toolName: event.toolName };
		case "toolcall.args":
			return { ...base, toolName: event.toolName, fieldCount: Object.keys(event.args).length };
		case "tool.start":
			return { ...base, toolName: event.toolName, startedAt: event.startedAt };
		case "tool.update":
			return { ...base, toolName: event.toolName };
		case "tool.phase":
			return { ...base, toolName: event.toolName, atMs: event.atMs };
		case "tool.end":
			return {
				...base,
				toolName: event.toolName,
				isError: event.isError,
				startedAt: event.startedAt,
				durationMs: event.durationMs,
				phaseCount: event.phases.length,
			};
		case "usage.update":
			return {
				...base,
				input: event.input,
				output: event.output,
				cacheRead: event.cacheRead,
				cacheWrite: event.cacheWrite,
				costTotal: event.costTotal,
				contextPercent: event.contextPercent,
				...(event.contextTokens === undefined ? {} : { contextTokens: event.contextTokens }),
				contextWindow: event.contextWindow,
				...(event.model
					? {
							modelApi: event.model.api,
							modelProvider: event.model.provider,
							modelId: event.model.id,
						}
					: {}),
			};
		case "error":
			return { ...base, failure: projectFailure(event.error) };
		case "session.extension":
			return { ...base, extensionId: event.extensionId, extensionEvent: event.event };
		case "retry.start":
			return {
				...base,
				attempt: event.attempt,
				maxAttempts: event.maxAttempts,
				delayMs: event.delayMs,
				...(event.failure ? { failure: projectFailure(event.failure) } : {}),
			};
		case "retry.end":
			return {
				...base,
				success: event.success,
				attempt: event.attempt,
				...(event.failure ? { failure: projectFailure(event.failure) } : {}),
			};
		case "active_tools_update":
			return { ...base, count: event.activeToolNames.length };
		case "compaction.start":
			return {
				...base,
				reason: event.reason,
				...(event.contextTokens === undefined ? {} : { contextTokens: event.contextTokens }),
				...(event.contextWindow === undefined ? {} : { contextWindow: event.contextWindow }),
				...(event.thresholdTokens === undefined ? {} : { thresholdTokens: event.thresholdTokens }),
			};
		case "compaction.end":
			return {
				...base,
				success: event.success,
				...(event.reason ? { reason: event.reason } : {}),
				...(event.tokensBefore === undefined ? {} : { tokensBefore: event.tokensBefore }),
				...(event.failure ? { failure: projectFailure(event.failure) } : {}),
			};
		default:
			return assertNever(event, base);
	}
}

function projectFailure(failure: RuntimeFailure): RuntimeSessionObservationSafeFailure {
	return Object.freeze({ code: failure.code, origin: failure.origin, retryable: failure.retryable });
}

function readTurnId(event: RuntimeSessionObservationEvent): string | undefined {
	return event.type === "error" ? event.turnId : undefined;
}

function readToolCallId(event: RuntimeSessionObservationEvent): string | undefined {
	return "toolCallId" in event ? event.toolCallId : undefined;
}

function assertNever(_value: never, fallback: RuntimeSessionObservationSummary): RuntimeSessionObservationSummary {
	return fallback;
}
