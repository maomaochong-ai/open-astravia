import type { AgentFeatureDefinition } from "@vetta/runtime-core/kernel";
import type { CodingAgentRuntimeToolRegistration } from "../runtime-contracts/index.js";

export function createCodingAgentMemoryRuntimeFeature(
	registration: CodingAgentRuntimeToolRegistration,
): AgentFeatureDefinition {
	return {
		id: "coding-agent.memory",
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
