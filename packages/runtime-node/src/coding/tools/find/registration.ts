import type { CodingToolRegistration } from "../../tool-registration.js";
import { createFindTool, type FindToolInput, type FindToolOptions } from "./find-tool.js";

export const FIND_TOOL_SCOPES = [] as const;
export const FIND_TOOL_CATEGORY = "core" as const;

export function createFindToolRegistration(
	cwd: string,
	options: FindToolOptions = {},
): CodingToolRegistration<FindToolInput> {
	return {
		tool: createFindTool(cwd, options),
		scopeUse: FIND_TOOL_SCOPES,
		category: FIND_TOOL_CATEGORY,
	};
}
