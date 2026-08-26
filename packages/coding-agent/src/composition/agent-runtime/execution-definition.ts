import {
	defineRuntimeAgent,
	type RuntimeAgentDefinition,
	type RuntimeAgentSessionDefinition,
	type RuntimeAgentSessionPreparationContext,
} from "@vetta/runtime-core";
import { DEFAULT_CODING_AGENT_RUNTIME_ID } from "../runtime-agent-definition.js";
import {
	requireCodingAgentExecutionRuntimeInstanceConfiguration,
	requireCodingAgentExecutionSessionRequest,
} from "./execution-instance-configuration.js";

export interface CodingAgentExecutionRuntimeDefinitionOptions {
	readonly id?: string;
	/**
	 * 在产品资源完成装配后、Runtime 编译前变换通用 Session Definition。
	 * revision 可以借此替换 Prompt、Feature、Tool、模型绑定或 Extension，而不接管产品外围资源。
	 */
	transformSessionDefinition?(
		context: RuntimeAgentSessionPreparationContext,
		definition: RuntimeAgentSessionDefinition,
		instanceConfiguration: unknown,
	): Promise<RuntimeAgentSessionDefinition> | RuntimeAgentSessionDefinition;
}

/** 创建可承载完整 Coding Agent Composition 的通用多主 Agent Definition。 */
export function createCodingAgentExecutionRuntimeDefinition(
	options: CodingAgentExecutionRuntimeDefinitionOptions = {},
): RuntimeAgentDefinition {
	return defineRuntimeAgent({
		id: options.id ?? DEFAULT_CODING_AGENT_RUNTIME_ID,
		createInstance: (instanceContext) => {
			const configuration = requireCodingAgentExecutionRuntimeInstanceConfiguration(instanceContext.configuration);
			return {
				async prepareSession(context) {
					const request = requireCodingAgentExecutionSessionRequest(context.configuration);
					const plan = await configuration.prepareSession(context, request);
					const definition =
						(await options.transformSessionDefinition?.(
							context,
							plan.definition,
							configuration.applicationConfiguration,
						)) ?? plan.definition;
					return { ...plan, definition };
				},
			};
		},
	});
}
