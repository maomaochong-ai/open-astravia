import type { ToolPhase } from "@vetta/agent-core";
import type { Message } from "@vetta/ai";
import type { BackgroundTaskInfo, RuntimeEventSource, SessionError, SubagentInfo, TodoItem } from "./contracts.js";

export type RuntimeSessionLifecyclePhase =
	| "created"
	| "agent_start"
	| "turn_start"
	| "turn_end"
	| "agent_end"
	| "aborted";

interface RuntimeSessionObservationBase {
	readonly source: RuntimeEventSource;
	readonly timestamp?: number;
}

/**
 * Session 执行期间的瞬时观察事件。
 *
 * 该合同不依赖旧 coding-agent AgentSessionEvent，也不包含宿主生成的 eventId、
 * sessionId 与 schemaVersion。生产旧后端和 Greenfield Kernel 都先适配到这里，
 * 再由 runtime-host 生成稳定的 SessionEvent。
 */
export type RuntimeSessionObservationEvent = RuntimeSessionObservationBase &
	(
		| { readonly type: "lifecycle"; readonly phase: RuntimeSessionLifecyclePhase }
		| { readonly type: "message.delta"; readonly delta: string }
		| { readonly type: "thinking.delta"; readonly delta: string }
		| { readonly type: "message.final"; readonly message: Message }
		| { readonly type: "toolcall.start"; readonly toolCallId: string; readonly toolName: string }
		| {
				readonly type: "tool.start";
				readonly toolCallId: string;
				readonly toolName: string;
				readonly args: unknown;
				readonly startedAt: number;
		  }
		| {
				readonly type: "tool.update";
				readonly toolCallId: string;
				readonly toolName: string;
				readonly partialResult: unknown;
		  }
		| {
				readonly type: "tool.phase";
				readonly toolCallId: string;
				readonly toolName: string;
				readonly label: string;
				readonly atMs: number;
		  }
		| {
				readonly type: "tool.end";
				readonly toolCallId: string;
				readonly toolName: string;
				readonly isError: boolean;
				readonly result: unknown;
				readonly startedAt: number;
				readonly durationMs: number;
				readonly phases: readonly ToolPhase[];
		  }
		| {
				readonly type: "mcp.status";
				readonly status: "connected" | "degraded" | "disconnected";
				readonly details?: string;
		  }
		| { readonly type: "mcp.reload.start" }
		| { readonly type: "mcp.reload.end"; readonly changed: boolean; readonly errorMessage?: string }
		| {
				readonly type: "usage.update";
				readonly input: number;
				readonly output: number;
				readonly cacheRead: number;
				readonly cacheWrite: number;
				readonly costTotal: number;
				readonly contextPercent: number | null;
				readonly contextWindow: number;
		  }
		| { readonly type: "error"; readonly error: SessionError }
		| { readonly type: "todo_update"; readonly items: readonly TodoItem[] }
		| { readonly type: "background_tasks_update"; readonly tasks: readonly BackgroundTaskInfo[] }
		| { readonly type: "subagents_update"; readonly agents: readonly SubagentInfo[] }
		| {
				readonly type: "retry.start";
				readonly attempt: number;
				readonly maxAttempts: number;
				readonly delayMs: number;
				readonly errorMessage: string;
		  }
		| {
				readonly type: "retry.end";
				readonly success: boolean;
				readonly attempt: number;
				readonly finalError?: string;
		  }
		| { readonly type: "active_tools_update"; readonly activeToolNames: readonly string[] }
		| { readonly type: "compaction.start"; readonly reason: "threshold" | "overflow" }
		| { readonly type: "compaction.end"; readonly success: boolean; readonly errorMessage?: string }
	);
