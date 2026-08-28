import type { ConversationScenario } from "../../../../profiles/index.js";
import type { CodingAgentRuntimeToolRegistration } from "../../../../runtime-contracts/index.js";
import { createListAgentsTool, type ListAgentsToolInput, type ListAgentsToolOptions } from "./list-agents-tool.js";

export const LIST_AGENTS_TOOL_SCOPES = [
	"conversation",
	"project",
	"cli",
] as const satisfies readonly ConversationScenario[];
export const LIST_AGENTS_TOOL_CATEGORY = "agent-control" as const;

export interface ListAgentsToolRegistrationOptions extends ListAgentsToolOptions {
	readonly modelOrder?: number;
}

export function createListAgentsToolRegistration(
	options: ListAgentsToolRegistrationOptions,
): CodingAgentRuntimeToolRegistration<ListAgentsToolInput> {
	return {
		tool: { ...createListAgentsTool(options), modelOrder: options.modelOrder },
		scopeUse: LIST_AGENTS_TOOL_SCOPES,
		modelOrder: options.modelOrder,
		category: LIST_AGENTS_TOOL_CATEGORY,
	};
}
