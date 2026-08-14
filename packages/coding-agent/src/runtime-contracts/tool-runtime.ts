import type { RuntimeToolDefinition } from "@vetta/runtime-core/kernel";
import type { ConversationScenario, ToolCategory, ToolSideEffect } from "../profiles/index.js";

export interface CodingAgentRuntimeToolRegistration {
	readonly tool: RuntimeToolDefinition;
	readonly scopeUse: readonly ConversationScenario[];
	readonly requires?: readonly string[];
	/** 副作用等级（宿主侧元数据，不进 LLM schema）。缺省 = light。 */
	readonly sideEffect?: ToolSideEffect;
	readonly modelOrder?: number;
	readonly category: ToolCategory;
}
