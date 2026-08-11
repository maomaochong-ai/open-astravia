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
	};
}
