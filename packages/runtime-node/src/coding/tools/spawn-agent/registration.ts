import type { CodingToolRegistration, CodingToolScope } from "../../tool-registration.js";
import { createSpawnAgentTool, type SpawnAgentToolInput, type SpawnAgentToolOptions } from "./spawn-agent-tool.js";

export const SPAWN_AGENT_TOOL_SCOPES = ["conversation", "project", "cli"] as const satisfies readonly CodingToolScope[];
export const SPAWN_AGENT_TOOL_CATEGORY = "agent-control" as const;

export interface SpawnAgentToolRegistrationOptions extends SpawnAgentToolOptions {
	readonly modelOrder?: number;
}

export function createSpawnAgentToolRegistration(
	options: SpawnAgentToolRegistrationOptions,
): CodingToolRegistration<SpawnAgentToolInput> {
	return {
		tool: { ...createSpawnAgentTool(options), modelOrder: options.modelOrder },
		scopeUse: SPAWN_AGENT_TOOL_SCOPES,
		modelOrder: options.modelOrder,
		category: SPAWN_AGENT_TOOL_CATEGORY,
		// 拉起子 agent 会产生模型计费，但都在本会话预算内且可由 interrupt_agent 回收，不判 heavy。
		sideEffect: "light",
	};
}
