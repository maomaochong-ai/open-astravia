import type { ConversationScenario } from "../../../../profiles/index.js";
import type { CodingAgentRuntimeToolRegistration } from "../../../../runtime-contracts/index.js";
import {
	createDispatchWorkflowsTool,
	type DispatchWorkflowsToolInput,
	type DispatchWorkflowsToolOptions,
} from "./dispatch-workflows-tool.js";

export const DISPATCH_WORKFLOWS_TOOL_SCOPES = [
	"conversation",
	"project",
	"cli",
] as const satisfies readonly ConversationScenario[];
export const DISPATCH_WORKFLOWS_TOOL_CATEGORY = "agent-control" as const;

export interface DispatchWorkflowsToolRegistrationOptions extends DispatchWorkflowsToolOptions {
	readonly modelOrder?: number;
}

export function createDispatchWorkflowsToolRegistration(
	options: DispatchWorkflowsToolRegistrationOptions,
): CodingAgentRuntimeToolRegistration<DispatchWorkflowsToolInput> {
	return {
		tool: { ...createDispatchWorkflowsTool(options), modelOrder: options.modelOrder },
		scopeUse: DISPATCH_WORKFLOWS_TOOL_SCOPES,
		modelOrder: options.modelOrder,
		category: DISPATCH_WORKFLOWS_TOOL_CATEGORY,
	};
}
