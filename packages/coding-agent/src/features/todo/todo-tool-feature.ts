import type { AgentFeatureDefinition } from "@vetta/runtime-core/kernel";
import type { CodingAgentRuntimeToolRegistration } from "../../runtime-contracts/index.js";
import { CODING_AGENT_MODEL_TOOL_ORDER } from "../../tool-policy/model-tool-order.js";
import type { CodingAgentTodoRuntime } from "./contracts.js";
import { createTodoToolRegistration, type TodoToolInput } from "./tool/index.js";

export function createCodingAgentTodoRuntimeToolRegistration(
	runtime: CodingAgentTodoRuntime,
): CodingAgentRuntimeToolRegistration<TodoToolInput> {
	const registration = createTodoToolRegistration({
		getTodoStore: () => runtime,
		modelOrder: CODING_AGENT_MODEL_TOOL_ORDER.todo,
	});
	return {
		...registration,
		tool: {
			...registration.tool,
			async execute(request) {
				const result = await registration.tool.execute(request);
				await runtime.flush();
				return result;
			},
		},
	};
}

export function createCodingAgentTodoRuntimeFeature(
	registration: CodingAgentRuntimeToolRegistration<TodoToolInput>,
): AgentFeatureDefinition {
	return {
		id: "coding-agent.todo",
		async prepare(context) {
			context.signal.throwIfAborted();
			return {
				async contribute(contributionContext) {
					contributionContext.signal.throwIfAborted();
					return { tools: [registration.tool] };
				},
				async dispose() {},
			};
		},
	};
}
