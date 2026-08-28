import type { ConversationScenario } from "../../../profiles/index.js";
import type { CodingAgentRuntimeToolRegistration } from "../../../runtime-contracts/index.js";
import { type CurrentTimeToolInput, type CurrentTimeToolOptions, createCurrentTimeTool } from "./current-time-tool.js";

export const CURRENT_TIME_TOOL_SCOPES = [
	"im-claw",
	"conversation",
	"project",
	"batch",
	"automation",
	"kb-processing",
	"cli",
] as const satisfies readonly ConversationScenario[];

export const CURRENT_TIME_TOOL_CATEGORY = "core" as const;

export function createCurrentTimeToolRegistration(
	options: CurrentTimeToolOptions = {},
): CodingAgentRuntimeToolRegistration<CurrentTimeToolInput> {
	return {
		tool: createCurrentTimeTool(options),
		scopeUse: CURRENT_TIME_TOOL_SCOPES,
		category: CURRENT_TIME_TOOL_CATEGORY,
	};
}
