import { CODING_TOOL_SCOPES, type CodingToolRegistration } from "../../tool-registration.js";
import { createWriteTool, type WriteToolInput, type WriteToolOptions } from "./write-tool.js";

export const WRITE_TOOL_SCOPES = CODING_TOOL_SCOPES;
export const WRITE_TOOL_CATEGORY = "core" as const;

export function createWriteToolRegistration(
	cwd: string,
	options: WriteToolOptions,
): CodingToolRegistration<WriteToolInput> {
	return {
		tool: createWriteTool(cwd, options),
		scopeUse: WRITE_TOOL_SCOPES,
		category: WRITE_TOOL_CATEGORY,
	};
}
