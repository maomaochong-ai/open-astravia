import type { AgentEvent } from "@vetta/agent-core";
import type { TodoItem } from "@vetta/coding-agent/session-extensions";
import type {
	BackgroundTaskInfo,
	RuntimeContextCompactionResult,
	RuntimeFailure,
	RuntimeSubagentSnapshot,
} from "@vetta/runtime-core";

export type CodingAgentRetryEvent =
	| {
			readonly type: "auto_retry_start";
			readonly attempt: number;
			readonly maxAttempts: number;
			readonly delayMs: number;
			readonly errorMessage: string;
			readonly failure?: RuntimeFailure;
	  }
	| {
			readonly type: "auto_retry_end";
			readonly success: boolean;
			readonly attempt: number;
			readonly finalError?: string;
			readonly failure?: RuntimeFailure;
	  };

export type CodingAgentProductSessionEvent =
	| { readonly type: "auto_compaction_start"; readonly reason: "threshold" | "overflow" }
	| {
			readonly type: "auto_compaction_end";
			readonly result: RuntimeContextCompactionResult | undefined;
			readonly aborted: boolean;
			readonly willRetry: boolean;
			readonly errorMessage?: string;
			readonly failure?: RuntimeFailure;
	  }
	| CodingAgentRetryEvent
	| { readonly type: "todo_update"; readonly items: ReadonlyArray<TodoItem> }
	| { readonly type: "background_tasks_update"; readonly tasks: ReadonlyArray<BackgroundTaskInfo> }
	| { readonly type: "subagents_update"; readonly agents: ReadonlyArray<RuntimeSubagentSnapshot> }
	| { readonly type: "mcp_reload_start" }
	| {
			readonly type: "mcp_reload_end";
			readonly changed: boolean;
			readonly errorMessage?: string;
			readonly failure?: RuntimeFailure;
	  }
	| {
			readonly type: "session_path_changed";
			readonly from: string | undefined;
			readonly to: string;
			readonly reason: "rollover";
	  };

/** Agent 内核事件与 Coding Agent 产品事件的稳定公共联合。 */
export type CodingAgentSessionEvent = AgentEvent | CodingAgentProductSessionEvent;

export type CodingAgentSessionEventListener = (event: CodingAgentSessionEvent) => void;
