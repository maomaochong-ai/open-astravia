import type { SubagentSpawnRequest } from "@vetta/runtime-subagents";
import type { CodingAgentSubagentSnapshot } from "../public-api/sdk/subagent-contract.js";

export type {
	CodingAgentSubagentSnapshot,
	CodingAgentSubagentTodoProgress,
} from "../public-api/sdk/subagent-contract.js";

export interface CodingAgentWorkflowDispatchRequest extends SubagentSpawnRequest {
	readonly todos: readonly string[];
}

/** Workflow Tool 使用的产品端口；通用 Subagent Coordinator 不解释 Todo。 */
export interface CodingAgentWorkflowDispatcherPort {
	dispatchWorkflows(requests: readonly CodingAgentWorkflowDispatchRequest[]): readonly CodingAgentSubagentSnapshot[];
}
