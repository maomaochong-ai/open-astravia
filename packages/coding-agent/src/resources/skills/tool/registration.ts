import type { ConversationScenario } from "../../../profiles/index.js";
import type { CodingAgentRuntimeToolRegistration } from "../../../runtime-contracts/index.js";
import { createInvokeSkillTool, type InvokeSkillToolInput, type InvokeSkillToolOptions } from "./invoke-skill-tool.js";

export const INVOKE_SKILL_TOOL_SCOPES = [
	"im-claw",
	"conversation",
	"project",
	"batch",
	"automation",
	"kb-processing",
	"cli",
] as const satisfies readonly ConversationScenario[];
export const INVOKE_SKILL_TOOL_CATEGORY = "agent-control" as const;

export interface InvokeSkillToolRegistrationOptions extends InvokeSkillToolOptions {
	readonly modelOrder?: number;
}

export function createInvokeSkillToolRegistration(
	options: InvokeSkillToolRegistrationOptions,
): CodingAgentRuntimeToolRegistration<InvokeSkillToolInput> {
	const tool = createInvokeSkillTool(options);
	return {
		tool: { ...tool, modelOrder: options.modelOrder },
		scopeUse: INVOKE_SKILL_TOOL_SCOPES,
		modelOrder: options.modelOrder,
		category: INVOKE_SKILL_TOOL_CATEGORY,
	};
}
