import type { CodingToolRegistration } from "../../tool-registration.js";
import { createToolSearchTool, type ToolSearchToolInput, type ToolSearchToolOptions } from "./tool-search-tool.js";

export const TOOL_SEARCH_TOOL_SCOPES = [] as const;
export const TOOL_SEARCH_TOOL_CATEGORY = "core" as const;

export interface ToolSearchToolRegistrationOptions extends ToolSearchToolOptions {
	readonly modelOrder?: number;
}

export function createToolSearchToolRegistration(
	options: ToolSearchToolRegistrationOptions,
): CodingToolRegistration<ToolSearchToolInput> {
	const tool = createToolSearchTool(options);
	return {
		tool: { ...tool, modelOrder: options.modelOrder },
		scopeUse: TOOL_SEARCH_TOOL_SCOPES,
		modelOrder: options.modelOrder,
		category: TOOL_SEARCH_TOOL_CATEGORY,
	};
}
