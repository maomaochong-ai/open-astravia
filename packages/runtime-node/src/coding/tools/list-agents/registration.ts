import type { CodingToolRegistration, CodingToolScope } from "../../tool-registration.js";
import { createListAgentsTool, type ListAgentsToolInput, type ListAgentsToolOptions } from "./list-agents-tool.js";

export const LIST_AGENTS_TOOL_SCOPES = ["conversation", "project", "cli"] as const satisfies readonly CodingToolScope[];
export const LIST_AGENTS_TOOL_CATEGORY = "agent-control" as const;

export interface ListAgentsToolRegistrationOptions extends ListAgentsToolOptions {
	readonly modelOrder?: number;
}

export function createListAgentsToolRegistration(
	options: ListAgentsToolRegistrationOptions,
): CodingToolRegistration<ListAgentsToolInput> {
	return {
		tool: { ...createListAgentsTool(options), modelOrder: options.modelOrder },
		scopeUse: LIST_AGENTS_TOOL_SCOPES,
		modelOrder: options.modelOrder,
		category: LIST_AGENTS_TOOL_CATEGORY,
	};
}
