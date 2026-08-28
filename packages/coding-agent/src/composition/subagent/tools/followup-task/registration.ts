import type { CodingToolScope } from "@vetta/runtime-tools/coding";
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
] as const satisfies readonly CodingToolScope[];
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
		// 同 spawn_agent：会话内计费、可回收，不判 heavy。
		sideEffect: "light",
	};
}
