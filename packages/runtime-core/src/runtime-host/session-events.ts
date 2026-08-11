import { randomUUID } from "node:crypto";
import type { SessionEvent, SessionEventBase } from "../contracts.js";
import type { RuntimeSessionLifecyclePhase, RuntimeSessionObservationEvent } from "../session-observation.js";

export function baseSessionEvent(
	sessionId: string,
	source: SessionEventBase["source"],
	timestamp = Date.now(),
): SessionEventBase {
	return {
		schemaVersion: 1,
		sessionId,
		eventId: randomUUID(),
		timestamp,
		source,
	};
}

export function lifecycleSessionEvent(
	sessionId: string,
	phase: RuntimeSessionLifecyclePhase,
	timestamp?: number,
): SessionEvent {
	return mapRuntimeSessionObservationEvent(sessionId, {
		type: "lifecycle",
		phase,
		source: "runtime-core",
		timestamp,
	});
}

/** 将独立 Runtime Session 观察事件封装为宿主稳定 SessionEvent。 */
export function mapRuntimeSessionObservationEvent(
	sessionId: string,
	event: RuntimeSessionObservationEvent,
	timestamp = event.timestamp,
): SessionEvent {
	const base = baseSessionEvent(sessionId, event.source, timestamp);
	switch (event.type) {
		case "lifecycle":
			return { ...base, type: "session.lifecycle", phase: event.phase };
		case "message.delta":
			return { ...base, type: event.type, delta: event.delta };
		case "thinking.delta":
			return { ...base, type: event.type, delta: event.delta };
		case "message.final":
			return { ...base, type: event.type, message: event.message };
		case "toolcall.start":
			return { ...base, type: event.type, toolCallId: event.toolCallId, toolName: event.toolName };
		case "toolcall.args":
			return {
				...base,
				type: event.type,
				toolCallId: event.toolCallId,
				toolName: event.toolName,
				args: event.args,
			};
		case "tool.start":
			return {
				...base,
				type: event.type,
				toolCallId: event.toolCallId,
				toolName: event.toolName,
				args: event.args,
				startedAt: event.startedAt,
			};
		case "tool.update":
			return {
				...base,
				type: event.type,
				toolCallId: event.toolCallId,
				toolName: event.toolName,
				partialResult: event.partialResult,
			};
		case "tool.phase":
			return {
				...base,
				type: event.type,
				toolCallId: event.toolCallId,
				toolName: event.toolName,
				label: event.label,
				atMs: event.atMs,
			};
		case "tool.end":
			return {
				...base,
				type: event.type,
				toolCallId: event.toolCallId,
				toolName: event.toolName,
				isError: event.isError,
				result: event.result,
				startedAt: event.startedAt,
				durationMs: event.durationMs,
				phases: [...event.phases],
			};
		case "mcp.status":
			return { ...base, type: event.type, status: event.status, details: event.details };
		case "mcp.reload.start":
			return { ...base, type: event.type };
		case "mcp.reload.end":
			return { ...base, type: event.type, changed: event.changed, errorMessage: event.errorMessage };
		case "usage.update":
			return {
				...base,
				type: event.type,
				input: event.input,
				output: event.output,
				cacheRead: event.cacheRead,
				cacheWrite: event.cacheWrite,
				costTotal: event.costTotal,
				contextPercent: event.contextPercent,
				contextWindow: event.contextWindow,
			};
		case "error":
			return { ...base, type: event.type, error: event.error };
		case "todo_update":
			return { ...base, type: event.type, items: [...event.items] };
		case "background_tasks_update":
			return { ...base, type: event.type, tasks: [...event.tasks] };
		case "subagents_update":
			return { ...base, type: event.type, agents: [...event.agents] };
		case "retry.start":
			return {
				...base,
				type: event.type,
				attempt: event.attempt,
				maxAttempts: event.maxAttempts,
				delayMs: event.delayMs,
				errorMessage: event.errorMessage,
			};
		case "retry.end":
			return {
				...base,
				type: event.type,
				success: event.success,
				attempt: event.attempt,
				finalError: event.finalError,
			};
		case "active_tools_update":
			return { ...base, type: event.type, activeToolNames: [...event.activeToolNames] };
		case "compaction.start":
			return { ...base, type: event.type, reason: event.reason };
		case "compaction.end":
			return { ...base, type: event.type, success: event.success, errorMessage: event.errorMessage };
	}
}
