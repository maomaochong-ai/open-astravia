import type { CodingToolRegistration } from "@vetta/runtime-tools";
import type { ToolSideEffect } from "../profiles/index.js";

/** Coding Agent 在通用 Runtime Tool 注册之上拥有的产品策略元数据。 */
export interface CodingAgentRuntimeToolRegistration<TInput extends object = Readonly<Record<string, unknown>>>
	extends CodingToolRegistration<TInput> {
	/** 副作用等级（宿主侧元数据，不进 LLM schema）。缺省 = light。 */
	readonly sideEffect?: ToolSideEffect;
}
