import {
	defineRuntimeAgent,
	type RuntimeAgentDefinition,
	type RuntimeAgentSessionDefinition,
	type RuntimeAgentSessionPreparationContext,
} from "@vetta/runtime-core";
import { DEFAULT_CODING_AGENT_RUNTIME_ID } from "../runtime-agent-definition.js";
import { requireCodingAgentRuntimeSessionAssemblyRequest } from "./session-assembly-request.js";

export interface CodingAgentExecutionRuntimeDefinitionOptions {
	readonly id?: string;
	/**
	 * 在产品资源完成装配后、Runtime 编译前变换通用 Session Definition。
	 * revision 可以借此替换 Prompt、Feature、Tool、模型绑定或 Extension，而不接管产品外围资源。
	 */
	transformSessionDefinition?(
		context: RuntimeAgentSessionPreparationContext,
		definition: RuntimeAgentSessionDefinition,
	): Promise<RuntimeAgentSessionDefinition> | RuntimeAgentSessionDefinition;
}

/** 创建可承载完整 Coding Agent Composition 的通用多主 Agent Definition。 */
export function createCodingAgentExecutionRuntimeDefinition(
	options: CodingAgentExecutionRuntimeDefinitionOptions = {},
): RuntimeAgentDefinition {
	return defineRuntimeAgent({
		id: options.id ?? DEFAULT_CODING_AGENT_RUNTIME_ID,
		createInstance: () => ({
			async createSession(context) {
				const request = requireCodingAgentRuntimeSessionAssemblyRequest(context.configuration);
				const definition = await request.prepare(context);
				return (await options.transformSessionDefinition?.(context, definition)) ?? definition;
			},
		}),
	});
}
