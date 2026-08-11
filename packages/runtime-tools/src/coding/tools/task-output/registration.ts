import type { CodingToolRegistration, CodingToolScope } from "../../tool-registration.js";
import { createTaskOutputTool, type TaskOutputToolInput, type TaskOutputToolOptions } from "./task-output-tool.js";

export const TASK_OUTPUT_TOOL_SCOPES = [
	"im-claw",
	"conversation",
	"project",
	"batch",
	"automation",
	"kb-processing",
	"cli",
] as const satisfies readonly CodingToolScope[];

export const TASK_OUTPUT_TOOL_REQUIRES = ["bg-tasks"] as const;
export const TASK_OUTPUT_TOOL_CATEGORY = "agent-control" as const;

export function createTaskOutputToolRegistration(
	options: TaskOutputToolOptions,
): CodingToolRegistration<TaskOutputToolInput> {
	return {
		tool: createTaskOutputTool(options),
		scopeUse: TASK_OUTPUT_TOOL_SCOPES,
		requires: TASK_OUTPUT_TOOL_REQUIRES,
		category: TASK_OUTPUT_TOOL_CATEGORY,
	};
}
