import type { AgentEvent } from "@astravia/agent-core";
import type { TodoItem } from "@astravia/coding-agent/session-extensions";
import type { RuntimeContextCompactionResult, RuntimeFailure } from "@astravia/runtime-core";
import type { BackgroundCommandSnapshot } from "@astravia/runtime-tools";
import type { CodingAgentSubagentSnapshot } from "./subagent-contract.js";

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

export type CodingAgentSessionFeatureEvent =
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
	| { readonly type: "background_tasks_update"; readonly tasks: ReadonlyArray<BackgroundCommandSnapshot> }
	| { readonly type: "subagents_update"; readonly agents: ReadonlyArray<CodingAgentSubagentSnapshot> }
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

/** Agent 内核事件与 Coding Agent Feature 事件的稳定公共联合。 */
export type CodingAgentSessionEvent = AgentEvent | CodingAgentSessionFeatureEvent;

export type CodingAgentSessionEventListener = (event: CodingAgentSessionEvent) => void;
