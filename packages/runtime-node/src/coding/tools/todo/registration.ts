import type { CodingToolRegistration, CodingToolScope } from "../../tool-registration.js";
import { createTodoTool, type TodoToolInput, type TodoToolOptions } from "./todo-tool.js";

export const TODO_TOOL_SCOPES = [
	"im-claw",
	"conversation",
	"project",
	"batch",
	"automation",
	"kb-processing",
	"cli",
] as const satisfies readonly CodingToolScope[];
export const TODO_TOOL_CATEGORY = "agent-control" as const;

export interface TodoToolRegistrationOptions extends TodoToolOptions {
	readonly modelOrder?: number;
}

export function createTodoToolRegistration(
	options: TodoToolRegistrationOptions,
): CodingToolRegistration<TodoToolInput> {
	const tool = createTodoTool(options);
	return {
		tool: { ...tool, modelOrder: options.modelOrder },
		scopeUse: TODO_TOOL_SCOPES,
		modelOrder: options.modelOrder,
		category: TODO_TOOL_CATEGORY,
	};
}
