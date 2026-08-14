import type { CodingToolRegistration, CodingToolScope } from "../../tool-registration.js";
import {
	createInterruptAgentTool,
	type InterruptAgentToolInput,
	type InterruptAgentToolOptions,
} from "./interrupt-agent-tool.js";

export const INTERRUPT_AGENT_TOOL_SCOPES = [
	"conversation",
	"project",
	"cli",
] as const satisfies readonly CodingToolScope[];
export const INTERRUPT_AGENT_TOOL_CATEGORY = "agent-control" as const;

export interface InterruptAgentToolRegistrationOptions extends InterruptAgentToolOptions {
	readonly modelOrder?: number;
}

export function createInterruptAgentToolRegistration(
	options: InterruptAgentToolRegistrationOptions,
): CodingToolRegistration<InterruptAgentToolInput> {
	return {
		tool: { ...createInterruptAgentTool(options), modelOrder: options.modelOrder },
		scopeUse: INTERRUPT_AGENT_TOOL_SCOPES,
		modelOrder: options.modelOrder,
		category: INTERRUPT_AGENT_TOOL_CATEGORY,
	};
}
