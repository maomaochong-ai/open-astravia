import type { ConversationScenario } from "../../../../profiles/index.js";
import type { CodingAgentRuntimeToolRegistration } from "../../../../runtime-contracts/index.js";
import { createSpawnAgentTool, type SpawnAgentToolInput, type SpawnAgentToolOptions } from "./spawn-agent-tool.js";

export const SPAWN_AGENT_TOOL_SCOPES = [
	"conversation",
	"project",
	"cli",
] as const satisfies readonly ConversationScenario[];
export const SPAWN_AGENT_TOOL_CATEGORY = "agent-control" as const;

export interface SpawnAgentToolRegistrationOptions extends SpawnAgentToolOptions {
	readonly modelOrder?: number;
}

export function createSpawnAgentToolRegistration(
	options: SpawnAgentToolRegistrationOptions,
): CodingAgentRuntimeToolRegistration<SpawnAgentToolInput> {
	return {
		tool: { ...createSpawnAgentTool(options), modelOrder: options.modelOrder },
		scopeUse: SPAWN_AGENT_TOOL_SCOPES,
		modelOrder: options.modelOrder,
		category: SPAWN_AGENT_TOOL_CATEGORY,
	};
}
