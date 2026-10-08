import type {
	AgentFeatureDefinition,
	ContextProvider,
	ModelCallContributionProvider,
} from "@vetta/runtime-core/kernel";
import { GOAL_INSTRUCTION_ID, renderGoalInstructions } from "./goal-instructions.js";
import type { CodingAgentGoalRuntime } from "./goal-runtime.js";
import { createGoalTools } from "./tools.js";

const GOAL_INSTRUCTION_PRIORITY = 950;

export function createCodingAgentGoalFeature(
	runtime: CodingAgentGoalRuntime,
	now: () => number,
): AgentFeatureDefinition {
	const tools = createGoalTools(runtime);
	const startupContext: ContextProvider = {
		id: "coding-agent.goal-start",
		async provide(input, signal) {
			signal.throwIfAborted();
			if (input.input || runtime.readState()?.status !== "active") return [];
			// Continue has no user input; provide a transient trigger even when history is empty.
			return [
				{
					role: "user",
					content: "Begin working toward the active goal defined in the system instructions.",
					timestamp: now(),
				},
			];
		},
	};
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
					return { modelCallProviders: [provider()], contextProviders: [startupContext] };
				},
				async dispose() {},
			};
		},
	};
}
