import type { CodingToolRegistration, CodingToolScope } from "../../tool-registration.js";
import { createTaskStopTool, type TaskStopToolInput, type TaskStopToolOptions } from "./task-stop-tool.js";

export const TASK_STOP_TOOL_SCOPES = [
	"im-claw",
	"conversation",
	"project",
	"batch",
	"automation",
	"kb-processing",
	"cli",
] as const satisfies readonly CodingToolScope[];

export const TASK_STOP_TOOL_REQUIRES = ["bg-tasks"] as const;
export const TASK_STOP_TOOL_CATEGORY = "agent-control" as const;

export function createTaskStopToolRegistration(
	options: TaskStopToolOptions,
): CodingToolRegistration<TaskStopToolInput> {
	return {
		tool: createTaskStopTool(options),
		scopeUse: TASK_STOP_TOOL_SCOPES,
		requires: TASK_STOP_TOOL_REQUIRES,
		category: TASK_STOP_TOOL_CATEGORY,
	};
}
