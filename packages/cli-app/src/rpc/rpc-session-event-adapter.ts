import type { SessionEvent } from "@vetta/runtime-core";

/**
 * Runtime SessionEvent 到现有 RPC wire event 的窄适配器。
 *
 * 这里只保证 RPC 宿主实际消费的字段，不把它声明为完整的历史
 * AgentEvent 适配器。Runtime 稳定事件没有携带流式 partial message、
 * turn toolResults 等历史细节，不能伪造这些数据。
 */
export class RpcSessionEventAdapter {
	private turnIndex = 0;

	map(event: SessionEvent): readonly unknown[] {
		switch (event.type) {
			case "session.lifecycle":
				return this.mapLifecycle(event.phase, event.timestamp);
			case "session.path_changed":
				return event.path
					? [
							{
								type: "session_path_changed",
								from: event.previousPath,
								to: event.path,
								reason: event.reason,
							},
						]
					: [
							{
								type: "error",
								error: "Runtime session path changed without a target path",
							},
						];
			case "message.delta":
				return [
					{
						type: "message_update",
						assistantMessageEvent: {
							type: "text_delta",
							contentIndex: 0,
							delta: event.delta,
						},
					},
				];
			case "thinking.delta":
				return [
					{
						type: "message_update",
						assistantMessageEvent: {
							type: "thinking_delta",
							contentIndex: 0,
							delta: event.delta,
						},
					},
				];
			case "message.final":
				return [{ type: "message_end", message: event.message }];
			case "tool.start":
				return [
					{
						type: "tool_execution_start",
						toolCallId: event.toolCallId,
						toolName: event.toolName,
						args: event.args,
						startedAt: event.startedAt,
					},
				];
			case "tool.update":
				return [
					{
						type: "tool_execution_update",
						toolCallId: event.toolCallId,
						toolName: event.toolName,
						partialResult: event.partialResult,
					},
				];
			case "tool.phase":
				return [
					{
						type: "tool_execution_phase",
						toolCallId: event.toolCallId,
						toolName: event.toolName,
						label: event.label,
						atMs: event.atMs,
					},
				];
			case "tool.end":
				return [
					{
						type: "tool_execution_end",
						toolCallId: event.toolCallId,
						toolName: event.toolName,
						result: event.result,
						isError: event.isError,
						startedAt: event.startedAt,
						durationMs: event.durationMs,
						phases: event.phases,
					},
				];
			case "error":
				return [
					{
						type: "error",
						error: event.error.message,
						data: { error: event.error.message, code: event.error.code },
					},
				];
			default:
				return [];
		}
	}

	private mapLifecycle(
		phase: Extract<SessionEvent, { type: "session.lifecycle" }>["phase"],
		timestamp: number,
	): readonly unknown[] {
		switch (phase) {
			case "agent_start":
				this.turnIndex = 0;
				return [{ type: "agent_start" }];
			case "turn_start":
				return [{ type: "turn_start", turnIndex: this.turnIndex, timestamp }];
			case "turn_end": {
				const event = { type: "turn_end", turnIndex: this.turnIndex };
				this.turnIndex += 1;
				return [event];
			}
			case "agent_end":
				return [{ type: "agent_end" }];
			case "created":
			case "aborted":
				return [];
		}
	}
}
