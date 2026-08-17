import type { CodingToolRegistration, CodingToolScope } from "@vetta/runtime-tools";
import { createInvokeSkillTool, type InvokeSkillToolInput, type InvokeSkillToolOptions } from "./invoke-skill-tool.js";

export const INVOKE_SKILL_TOOL_SCOPES = [
	"im-claw",
	"conversation",
	"project",
	"batch",
	"automation",
	"kb-processing",
	"cli",
] as const satisfies readonly CodingToolScope[];
export const INVOKE_SKILL_TOOL_CATEGORY = "agent-control" as const;

export interface InvokeSkillToolRegistrationOptions extends InvokeSkillToolOptions {
	readonly modelOrder?: number;
}

export function createInvokeSkillToolRegistration(
	options: InvokeSkillToolRegistrationOptions,
): CodingToolRegistration<InvokeSkillToolInput> {
	const tool = createInvokeSkillTool(options);
	return {
		tool: { ...tool, modelOrder: options.modelOrder },
		scopeUse: INVOKE_SKILL_TOOL_SCOPES,
		modelOrder: options.modelOrder,
		category: INVOKE_SKILL_TOOL_CATEGORY,
	};
}
