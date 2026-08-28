import type { SubagentSnapshot } from "@vetta/runtime-subagents";

export interface CodingAgentSubagentTodoProgress {
	readonly done: number;
	readonly total: number;
}

/** Coding Agent 对通用调度快照叠加的稳定产品视图。 */
export interface CodingAgentSubagentSnapshot extends SubagentSnapshot {
	readonly todoProgress?: CodingAgentSubagentTodoProgress;
}
