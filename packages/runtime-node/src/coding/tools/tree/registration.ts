import { CODING_TOOL_SCOPES, type CodingToolRegistration } from "../../tool-registration.js";
import { createTreeTool, type TreeToolInput, type TreeToolOptions } from "./tree-tool.js";

export const TREE_TOOL_SCOPES = CODING_TOOL_SCOPES;
export const TREE_TOOL_CATEGORY = "core" as const;

export function createTreeToolRegistration(
	cwd: string,
	options: TreeToolOptions = {},
): CodingToolRegistration<TreeToolInput> {
	return {
		tool: createTreeTool(cwd, options),
		scopeUse: TREE_TOOL_SCOPES,
		category: TREE_TOOL_CATEGORY,
	};
}
