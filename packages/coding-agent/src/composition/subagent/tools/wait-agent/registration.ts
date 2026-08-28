import type { ConversationScenario } from "../../../../profiles/index.js";
import type { CodingAgentRuntimeToolRegistration } from "../../../../runtime-contracts/index.js";
import { createWaitAgentTool, type WaitAgentToolInput, type WaitAgentToolOptions } from "./wait-agent-tool.js";

export const WAIT_AGENT_TOOL_SCOPES = [
	"conversation",
	"project",
	"cli",
] as const satisfies readonly ConversationScenario[];
export const WAIT_AGENT_TOOL_CATEGORY = "agent-control" as const;

export interface WaitAgentToolRegistrationOptions extends WaitAgentToolOptions {
	readonly modelOrder?: number;
}

export function createWaitAgentToolRegistration(
	options: WaitAgentToolRegistrationOptions,
): CodingAgentRuntimeToolRegistration<WaitAgentToolInput> {
	return {
		tool: { ...createWaitAgentTool(options), modelOrder: options.modelOrder },
		scopeUse: WAIT_AGENT_TOOL_SCOPES,
		modelOrder: options.modelOrder,
		category: WAIT_AGENT_TOOL_CATEGORY,
	};
}
