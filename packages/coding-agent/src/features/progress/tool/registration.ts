import type { ConversationScenario } from "../../../profiles/index.js";
import type { CodingAgentRuntimeToolRegistration } from "../../../runtime-contracts/index.js";
import { createProgressTool, type ProgressToolInput } from "./progress-tool.js";

export const PROGRESS_TOOL_SCOPES = [
	"im-claw",
	"conversation",
	"project",
	"batch",
	"automation",
	"kb-processing",
	"cli",
] as const satisfies readonly ConversationScenario[];

export const PROGRESS_TOOL_CATEGORY = "agent-control" as const;

export interface ProgressToolRegistrationOptions {
	readonly modelOrder?: number;
}

export function createProgressToolRegistration(
	options: ProgressToolRegistrationOptions = {},
): CodingAgentRuntimeToolRegistration<ProgressToolInput> {
	return {
		tool: { ...createProgressTool(), modelOrder: options.modelOrder },
		scopeUse: PROGRESS_TOOL_SCOPES,
		modelOrder: options.modelOrder,
		category: PROGRESS_TOOL_CATEGORY,
	};
}
