import type { ConversationScenario } from "../../../../profiles/index.js";
import type { CodingAgentRuntimeToolRegistration } from "../../../../runtime-contracts/index.js";
import {
	createFollowupTaskTool,
	type FollowupTaskToolInput,
	type FollowupTaskToolOptions,
} from "./followup-task-tool.js";

export const FOLLOWUP_TASK_TOOL_SCOPES = [
	"conversation",
	"project",
	"cli",
] as const satisfies readonly ConversationScenario[];
export const FOLLOWUP_TASK_TOOL_CATEGORY = "agent-control" as const;

export interface FollowupTaskToolRegistrationOptions extends FollowupTaskToolOptions {
	readonly modelOrder?: number;
}

export function createFollowupTaskToolRegistration(
	options: FollowupTaskToolRegistrationOptions,
): CodingAgentRuntimeToolRegistration<FollowupTaskToolInput> {
	return {
		tool: { ...createFollowupTaskTool(options), modelOrder: options.modelOrder },
		scopeUse: FOLLOWUP_TASK_TOOL_SCOPES,
		modelOrder: options.modelOrder,
		category: FOLLOWUP_TASK_TOOL_CATEGORY,
	};
}
