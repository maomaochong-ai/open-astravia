import type { RuntimeToolDefinition } from "@vetta/runtime-core/kernel";
import type { CodingToolRegistration } from "@vetta/runtime-tools";
import {
	type ConversationScenario,
	DEFAULT_SCENARIO,
	type ToolCategory,
	type ToolSideEffect,
} from "../profiles/index.js";

/** Coding Agent 在通用 Runtime Tool 注册之上拥有的产品策略元数据。 */
export interface CodingAgentRuntimeToolRegistration<TInput extends object = Readonly<Record<string, unknown>>>
	extends CodingToolRegistration<TInput> {
	readonly scopeUse: readonly ConversationScenario[];
	/** 普通场景激活所需能力；显式启用保持既有的绕过语义。 */
	readonly requires?: readonly string[];
	readonly category: ToolCategory;
	/** 需要额外领域 Runtime 才可见；显式激活也不能绕过。 */
	readonly availabilityPolicy?: "knowledge-runtime";
	/** 结果投影行为是独立策略，不由展示分类隐式推导。 */
	readonly resultProjection?: "preserve";
	/** 副作用等级（宿主侧元数据，不进 LLM schema）。缺省 = light。 */
	readonly sideEffect?: ToolSideEffect;
}

export type CodingAgentToolActivation =
	| {
			readonly mode: "scope";
			readonly scope?: ConversationScenario;
			readonly additionallyEnabledToolNames?: readonly string[];
			readonly capabilities?: ReadonlySet<string>;
	  }
	| {
			readonly mode: "explicit";
			readonly toolNames: readonly string[];
	  };

export function selectCodingAgentToolRegistrations<T extends CodingAgentRuntimeToolRegistration>(
	registrations: readonly T[],
	activation: CodingAgentToolActivation,
): readonly T[] {
	if (activation.mode === "explicit") {
		const explicitlyEnabled = new Set(activation.toolNames);
		return registrations.filter((registration) => explicitlyEnabled.has(registration.tool.name));
	}

	const scope = activation.scope ?? DEFAULT_SCENARIO;
	const additionallyEnabled = new Set(activation.additionallyEnabledToolNames ?? []);
	const capabilities = activation.capabilities ?? new Set<string>();
	return registrations.filter(
		(registration) =>
			additionallyEnabled.has(registration.tool.name) ||
			(registration.scopeUse.includes(scope) &&
				(registration.requires ?? []).every((capability) => capabilities.has(capability))),
	);
}

export function selectCodingAgentTools(
	registrations: readonly CodingAgentRuntimeToolRegistration[],
	activation: CodingAgentToolActivation,
): readonly RuntimeToolDefinition[] {
	return selectCodingAgentToolRegistrations(registrations, activation).map(({ tool }) => tool);
}
