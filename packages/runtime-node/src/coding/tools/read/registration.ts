import type { CodingToolRegistration, CodingToolScope } from "../../tool-registration.js";
import { createReadTool, type ReadToolInput, type ReadToolOptions } from "./read-tool.js";

export const READ_TOOL_SCOPES = [
	"im-claw",
	"conversation",
	"project",
	"batch",
	"automation",
	"kb-processing",
	"cli",
] as const satisfies readonly CodingToolScope[];

export const READ_TOOL_CATEGORY = "core" as const;

export function createReadToolRegistration(
	cwd: string,
	options: ReadToolOptions = {},
): CodingToolRegistration<ReadToolInput> {
	return {
		tool: createReadTool(cwd, options),
		scopeUse: READ_TOOL_SCOPES,
		category: READ_TOOL_CATEGORY,
	};
}
