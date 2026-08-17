import type { CodingToolRegistration, CodingToolScope } from "../../tool-registration.js";
import { createGrepTool, type GrepToolInput, type GrepToolOptions } from "./grep-tool.js";

export const GREP_TOOL_SCOPES = [
	"im-claw",
	"conversation",
	"project",
	"batch",
	"automation",
	"kb-processing",
	"cli",
] as const satisfies readonly CodingToolScope[];

export const GREP_TOOL_CATEGORY = "core" as const;

export function createGrepToolRegistration(
	cwd: string,
	options: GrepToolOptions = {},
): CodingToolRegistration<GrepToolInput> {
	return {
		tool: createGrepTool(cwd, options),
		scopeUse: GREP_TOOL_SCOPES,
		category: GREP_TOOL_CATEGORY,
	};
}
