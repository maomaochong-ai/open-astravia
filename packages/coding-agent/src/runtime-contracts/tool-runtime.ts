import type { RuntimeToolDefinition } from "@vetta/runtime-core/kernel";
import type { ConversationScenario, ToolCategory } from "../profiles/index.js";

export interface CodingAgentRuntimeToolRegistration {
	readonly tool: RuntimeToolDefinition;
	readonly scopeUse: readonly ConversationScenario[];
	readonly requires?: readonly string[];
	readonly agentModes?: readonly string[];
	readonly modelOrder?: number;
	readonly category: ToolCategory;
}
