import type { AgentFeatureDefinition, ModelCallContributionProvider } from "@vetta/runtime-core/kernel";
import { GOAL_INSTRUCTION_ID, renderGoalInstructions } from "./goal-instructions.js";
import type { CodingAgentGoalRuntime } from "./goal-runtime.js";
import { createGoalTools } from "./tools.js";

const GOAL_INSTRUCTION_PRIORITY = 950;

export function createCodingAgentGoalFeature(runtime: CodingAgentGoalRuntime): AgentFeatureDefinition {
	const tools = createGoalTools(runtime);
	const provider = (): ModelCallContributionProvider => ({
		id: "coding-agent.goal",
		bindForTurn: () => provider(),
		async contribute(context) {
			context.signal.throwIfAborted();
			const goal = runtime.readState();
			return {
				tools,
				...(goal?.status === "active"
					? {
							instructions: [
								{
									id: GOAL_INSTRUCTION_ID,
									content: renderGoalInstructions(goal),
									priority: GOAL_INSTRUCTION_PRIORITY,
								},
							],
						}
					: {}),
			};
		},
	});
	return {
		id: "coding-agent.goal",
		async prepare(context) {
			context.signal.throwIfAborted();
			return {
				async contribute(contributionContext) {
					contributionContext.signal.throwIfAborted();
					return { modelCallProviders: [provider()] };
				},
				async dispose() {},
			};
		},
	};
}
