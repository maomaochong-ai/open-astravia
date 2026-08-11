import type { CodingToolRegistration, CodingToolScope } from "../../tool-registration.js";
import { type CurrentTimeToolInput, type CurrentTimeToolOptions, createCurrentTimeTool } from "./current-time-tool.js";

export const CURRENT_TIME_TOOL_SCOPES = [
	"im-claw",
	"conversation",
	"project",
	"batch",
	"automation",
	"kb-processing",
	"cli",
] as const satisfies readonly CodingToolScope[];

export const CURRENT_TIME_TOOL_CATEGORY = "core" as const;

export function createCurrentTimeToolRegistration(
	options: CurrentTimeToolOptions = {},
): CodingToolRegistration<CurrentTimeToolInput> {
	return {
		tool: createCurrentTimeTool(options),
		scopeUse: CURRENT_TIME_TOOL_SCOPES,
		category: CURRENT_TIME_TOOL_CATEGORY,
	};
}
