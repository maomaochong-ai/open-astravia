import type { AgentFeatureDefinition } from "@vetta/runtime-core/kernel";
import {
	type CodingToolRegistration,
	createTodoToolRegistration,
	type TodoToolInput,
} from "@vetta/runtime-tools/coding";
import { CODING_AGENT_MODEL_TOOL_ORDER } from "../tool-policy/model-tool-order.js";
import type { CodingAgentTodoRuntime } from "./contracts.js";

export function createCodingAgentTodoRuntimeToolRegistration(
	runtime: CodingAgentTodoRuntime,
): CodingToolRegistration<TodoToolInput> {
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
	registration: CodingToolRegistration<TodoToolInput>,
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
