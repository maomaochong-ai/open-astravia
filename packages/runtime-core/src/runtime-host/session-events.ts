import { randomUUID } from "node:crypto";
import type { Message } from "@vetta/ai";
import type { AgentSession, AgentSessionEvent } from "@vetta/coding-agent";
import type { SessionError, SessionEvent, SessionEventBase } from "../contracts.js";
import { runtimeError } from "../errors.js";
import { ASSISTANT_TURN_TIMING_TYPE, extractAssistantText } from "./history.js";

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
	phase: "created" | "agent_start" | "turn_start" | "turn_end" | "agent_end" | "aborted",
	timestamp?: number,
): SessionEvent {
	return {
		...baseSessionEvent(sessionId, "runtime-core", timestamp),
		type: "session.lifecycle",
		phase,
	};
}

/** 挂起中、尚未确定是否会被自动重试掩盖的 assistant 错误。 */
type PendingAssistantError = {
	error: SessionError;
	/** 已经发生过的自动重试次数（由 auto_retry_start 累计）。 */
	retryAttempts: number;
};

export type MapAgentEventState = {
	/** 当前回合 start 时间；agent_start 写入，agent_end 消费后清除。 */
	currentTurnStartedAt: Map<string, number>;
	/**
	 * 每会话至多一条挂起错误。见文件头「错误延迟发射」说明与 ADR-0038。
	 * 唯一的兑现出口是 flushPendingError()，调用方是 RuntimeHost.prompt() 的 finally。
	 */
	pendingError: Map<string, PendingAssistantError>;
};

/**
 * 取出并清空某会话的挂起错误，转成可广播的 error 事件。
 *
 * 必须在每次 prompt() 收尾时调用（含 abort / throw 路径），否则错误会被永久
 * 吞掉——这是延迟发射机制唯一的失败模式。
 */
export function flushPendingError(sessionId: string, state: MapAgentEventState): SessionEvent | null {
	const pending = state.pendingError.get(sessionId);
	if (!pending) return null;
	state.pendingError.delete(sessionId);
	return {
		...baseSessionEvent(sessionId, "agent"),
		type: "error",
		error: pending.error,
		retryAttempts: pending.retryAttempts,
	};
}

/**
 * 将 coding-agent AgentSessionEvent 映射为宿主 SessionEvent[]。
 * 副作用限于 state 上的两个 Map：回合计时（与 persistAssistantTurnTiming 落盘）
 * 与挂起错误。
 *
 * 「错误延迟发射」（ADR-0038）：assistant 的失败不在 message_end 当场发出，先挂进
 * state.pendingError。因为 coding-agent 要到之后的 agent_end 才决定要不要自动重试，
 * 当场发等于把重试过程中的每次失败都当成终态错误刷给用户。挂起项的去向只有三个：
 * 被 auto_retry_end(success) / 成功的 message_end 清掉、被 aborted 清掉、或由
 * flushPendingError() 在 prompt() 收尾时兑现成唯一一条 error 事件。
 */
export function mapAgentSessionEvent(
	sessionId: string,
	event: AgentSessionEvent,
	session: AgentSession,
	state: MapAgentEventState,
): SessionEvent[] {
	const events: SessionEvent[] = [];

	if (event.type === "agent_start") {
		const startedAt = Date.now();
		state.currentTurnStartedAt.set(sessionId, startedAt);
		events.push(lifecycleSessionEvent(sessionId, "agent_start", startedAt));
		return events;
	}

	if (event.type === "turn_start") {
		events.push(lifecycleSessionEvent(sessionId, "turn_start"));
		return events;
	}

	if (event.type === "turn_end") {
		events.push(lifecycleSessionEvent(sessionId, "turn_end"));
		return events;
	}

	if (event.type === "agent_end") {
		const endedAt = Date.now();
		persistAssistantTurnTiming(sessionId, session, endedAt, state.currentTurnStartedAt);
		events.push(lifecycleSessionEvent(sessionId, "agent_end", endedAt));
		return events;
	}

	if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
		events.push({
			...baseSessionEvent(sessionId, "agent"),
			type: "message.delta",
			delta: event.assistantMessageEvent.delta,
		});
		return events;
	}

	if (event.type === "message_update" && event.assistantMessageEvent.type === "thinking_delta") {
		events.push({
			...baseSessionEvent(sessionId, "agent"),
			type: "thinking.delta",
			delta: event.assistantMessageEvent.delta,
		});
		return events;
	}

	if (event.type === "message_update" && event.assistantMessageEvent.type === "toolcall_start") {
		const partial = event.assistantMessageEvent.partial;
		const contentIndex = event.assistantMessageEvent.contentIndex;
		const toolContent = partial?.content?.[contentIndex];
		if (toolContent && toolContent.type === "toolCall") {
			events.push({
				...baseSessionEvent(sessionId, "agent"),
				type: "toolcall.start",
				toolCallId: String(toolContent.id ?? ""),
				toolName: String(toolContent.name ?? ""),
			});
		}
		return events;
	}

	if (event.type === "message_end" && event.message.role === "assistant") {
		events.push({
			...baseSessionEvent(sessionId, "agent"),
			type: "message.final",
			message: event.message as Message,
		});

		const contextUsage = session.getContextUsage();
		events.push({
			...baseSessionEvent(sessionId, "agent"),
			type: "usage.update",
			input: event.message.usage.input,
			output: event.message.usage.output,
			cacheRead: event.message.usage.cacheRead,
			cacheWrite: event.message.usage.cacheWrite,
			costTotal: event.message.usage.cost.total,
			contextPercent: contextUsage?.percent ?? null,
			contextWindow: contextUsage?.contextWindow ?? 0,
		});

		if (event.message.stopReason === "error") {
			const errorText =
				extractAssistantText(event.message.content) ||
				(event.message as Message & { errorMessage?: string }).errorMessage ||
				"Assistant response ended with error";
			console.error(`[RuntimeHost.event] session=${sessionId} type=assistant_error message=${errorText}`);
			// 延迟发射：此刻还不知道 coding-agent 会不会自动重试（重试判定发生在
			// 后续的 agent_end，见 coding-agent event-router.ts）。直接发出去会让
			// 一次限流在 UI 上刷出 N 条一模一样的错误。挂起，由 flushPendingError
			// 在 prompt() 收尾时兑现，或被随后的成功 / 中止清掉。
			state.pendingError.set(sessionId, {
				error: runtimeError("INTERNAL_ERROR", errorText, true, "provider"),
				retryAttempts: state.pendingError.get(sessionId)?.retryAttempts ?? 0,
			});
		} else if (event.message.stopReason === "aborted") {
			console.warn(`[RuntimeHost.event] session=${sessionId} type=aborted`);
			// 用户主动停止：重试期攒下的错误不再打扰他。
			state.pendingError.delete(sessionId);
			const endedAt = Date.now();
			events.push(lifecycleSessionEvent(sessionId, "aborted", endedAt));
		} else {
			// 本回合恢复了（含压缩后重跑成功、重试成功），挂起的错误作废。
			state.pendingError.delete(sessionId);
		}
		// NOTE: Do NOT emit agent_end here. In a multi-turn agent loop,
		// message_end fires after each LLM call, not just the final one.
		// The real agent_end comes from the "agent_end" session event.
		return events;
	}

	if (event.type === "tool_execution_start") {
		events.push({
			...baseSessionEvent(sessionId, "tool"),
			type: "tool.start",
			toolCallId: event.toolCallId,
			toolName: event.toolName,
			args: event.args,
			startedAt: event.startedAt,
		});
		return events;
	}

	if (event.type === "tool_execution_update") {
		events.push({
			...baseSessionEvent(sessionId, "tool"),
			type: "tool.update",
			toolCallId: event.toolCallId,
			toolName: event.toolName,
			partialResult: event.partialResult,
		});
		return events;
	}

	if (event.type === "tool_execution_phase") {
		events.push({
			...baseSessionEvent(sessionId, "tool"),
			type: "tool.phase",
			toolCallId: event.toolCallId,
			toolName: event.toolName,
			label: event.label,
			atMs: event.atMs,
		});
		return events;
	}

	if (event.type === "tool_execution_end") {
		events.push({
			...baseSessionEvent(sessionId, "tool"),
			type: "tool.end",
			toolCallId: event.toolCallId,
			toolName: event.toolName,
			isError: event.isError,
			result: event.result,
			startedAt: event.startedAt,
			durationMs: event.durationMs,
			phases: event.phases,
		});
		return events;
	}

	if (event.type === "auto_retry_start") {
		console.warn(
			`[RuntimeHost.event] session=${sessionId} type=auto_retry_start attempt=${event.attempt}/${event.maxAttempts} delayMs=${event.delayMs} message=${event.errorMessage}`,
		);
		const pending = state.pendingError.get(sessionId);
		if (pending) pending.retryAttempts = event.attempt;
		events.push({
			...baseSessionEvent(sessionId, "agent"),
			type: "retry.start",
			attempt: event.attempt,
			maxAttempts: event.maxAttempts,
			delayMs: event.delayMs,
			errorMessage: event.errorMessage,
		});
		return events;
	}

	if (event.type === "auto_retry_end") {
		// 重试成功 = 上一轮失败已被掩盖，挂起的错误作废（message_end 那边也会清，
		// 但成功事件先到，这里兜住只 emit auto_retry_end 不再有 message_end 的实现）。
		if (event.success) state.pendingError.delete(sessionId);
		events.push({
			...baseSessionEvent(sessionId, "agent"),
			type: "retry.end",
			success: event.success,
			attempt: event.attempt,
			finalError: event.finalError,
		});
		return events;
	}

	if (event.type === "todo_update") {
		events.push({
			...baseSessionEvent(sessionId, "agent"),
			type: "todo_update",
			items: event.items as any[],
		});
		return events;
	}

	if (event.type === "background_tasks_update") {
		events.push({
			...baseSessionEvent(sessionId, "agent"),
			type: "background_tasks_update",
			tasks: event.tasks as any[],
		});
		return events;
	}

	if (event.type === "subagents_update") {
		events.push({
			...baseSessionEvent(sessionId, "agent"),
			type: "subagents_update",
			agents: event.agents as any[],
		});
		return events;
	}

	if (event.type === "auto_compaction_start") {
		events.push({
			...baseSessionEvent(sessionId, "agent"),
			type: "compaction.start",
			reason: event.reason,
		});
		return events;
	}

	if (event.type === "mcp_reload_start") {
		events.push({
			...baseSessionEvent(sessionId, "agent"),
			type: "mcp.reload.start",
		});
		return events;
	}

	if (event.type === "mcp_reload_end") {
		events.push({
			...baseSessionEvent(sessionId, "agent"),
			type: "mcp.reload.end",
			changed: event.changed,
			errorMessage: event.errorMessage,
		});
		return events;
	}

	if (event.type === "auto_compaction_end") {
		events.push({
			...baseSessionEvent(sessionId, "agent"),
			type: "compaction.end",
			success: !!event.result && !event.aborted,
			errorMessage: event.errorMessage,
		});
		return events;
	}

	return events;
}

export function persistAssistantTurnTiming(
	sessionId: string,
	session: AgentSession,
	endedAt: number,
	currentTurnStartedAt: Map<string, number>,
): void {
	const startedAt = currentTurnStartedAt.get(sessionId);
	if (!startedAt) return;
	currentTurnStartedAt.delete(sessionId);
	session.sessionManager.appendCustomEntry(ASSISTANT_TURN_TIMING_TYPE, {
		startedAt,
		endedAt,
		durationMs: Math.max(0, endedAt - startedAt),
	});
}
