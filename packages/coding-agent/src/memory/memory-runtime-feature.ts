import type { AgentFeatureDefinition } from "@vetta/runtime-core/kernel";
import type { CodingToolRegistration } from "@vetta/runtime-tools/coding";

export function createCodingAgentMemoryRuntimeFeature(registration: CodingToolRegistration): AgentFeatureDefinition {
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
