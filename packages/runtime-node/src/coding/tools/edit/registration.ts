import { CODING_TOOL_SCOPES, type CodingToolRegistration } from "../../tool-registration.js";
import type { EditToolOptions } from "./edit-contracts.js";
import { createEditTool } from "./edit-tool.js";
import type { EditToolInput } from "./schema.js";

export const EDIT_TOOL_SCOPES = CODING_TOOL_SCOPES;
export const EDIT_TOOL_CATEGORY = "core" as const;

export function createEditToolRegistration(
	cwd: string,
	options: EditToolOptions,
): CodingToolRegistration<EditToolInput> {
	return {
		tool: createEditTool(cwd, options),
		scopeUse: EDIT_TOOL_SCOPES,
		category: EDIT_TOOL_CATEGORY,
	};
}
