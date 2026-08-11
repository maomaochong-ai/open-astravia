import type { CodingToolRegistration, CodingToolScope } from "../../tool-registration.js";
import { createMemoryTool, type MemoryToolInput, type MemoryToolOptions } from "./memory-tool.js";

export const MEMORY_TOOL_SCOPES = ["im-claw"] as const satisfies readonly CodingToolScope[];
export const MEMORY_TOOL_CATEGORY = "memory" as const;

export interface MemoryToolRegistrationOptions extends MemoryToolOptions {
	readonly modelOrder?: number;
}

export function createMemoryToolRegistration(
	options: MemoryToolRegistrationOptions,
): CodingToolRegistration<MemoryToolInput> {
	const tool = createMemoryTool(options);
	return {
		tool: { ...tool, modelOrder: options.modelOrder },
		scopeUse: MEMORY_TOOL_SCOPES,
		modelOrder: options.modelOrder,
		category: MEMORY_TOOL_CATEGORY,
	};
}
