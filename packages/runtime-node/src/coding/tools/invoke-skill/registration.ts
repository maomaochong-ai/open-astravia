import type { CodingToolRegistration, CodingToolScope } from "../../tool-registration.js";
import {
	createInvokeSkillTool,
	type InvokableSkillDescriptor,
	type InvokeSkillToolInput,
	type InvokeSkillToolOptions,
} from "./invoke-skill-tool.js";

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

export interface InvokeSkillToolRegistrationOptions<TSkill extends InvokableSkillDescriptor>
	extends InvokeSkillToolOptions<TSkill> {
	readonly modelOrder?: number;
}

export function createInvokeSkillToolRegistration<TSkill extends InvokableSkillDescriptor>(
	options: InvokeSkillToolRegistrationOptions<TSkill>,
): CodingToolRegistration<InvokeSkillToolInput> {
	const tool = createInvokeSkillTool(options);
	return {
		tool: { ...tool, modelOrder: options.modelOrder },
		scopeUse: INVOKE_SKILL_TOOL_SCOPES,
		modelOrder: options.modelOrder,
		category: INVOKE_SKILL_TOOL_CATEGORY,
	};
}
