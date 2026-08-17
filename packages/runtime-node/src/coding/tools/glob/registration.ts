import type { CodingToolRegistration, CodingToolScope } from "../../tool-registration.js";
import { createGlobTool, type GlobToolInput, type GlobToolOptions } from "./glob-tool.js";

export const GLOB_TOOL_SCOPES = [
	"im-claw",
	"conversation",
	"project",
	"batch",
	"automation",
	"kb-processing",
	"cli",
] as const satisfies readonly CodingToolScope[];

export const GLOB_TOOL_CATEGORY = "core" as const;

export function createGlobToolRegistration(
	cwd: string,
	options: GlobToolOptions = {},
): CodingToolRegistration<GlobToolInput> {
	return {
		tool: createGlobTool(cwd, options),
		scopeUse: GLOB_TOOL_SCOPES,
		category: GLOB_TOOL_CATEGORY,
	};
}
