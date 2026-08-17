import type { CodingToolRegistration, CodingToolScope } from "../../tool-registration.js";
import { createLsTool, type LsToolInput, type LsToolOptions } from "./ls-tool.js";

export const LS_TOOL_SCOPES = [] as const satisfies readonly CodingToolScope[];

export const LS_TOOL_CATEGORY = "core" as const;

export function createLsToolRegistration(
	cwd: string,
	options: LsToolOptions = {},
): CodingToolRegistration<LsToolInput> {
	return {
		tool: createLsTool(cwd, options),
		scopeUse: LS_TOOL_SCOPES,
		category: LS_TOOL_CATEGORY,
	};
}
