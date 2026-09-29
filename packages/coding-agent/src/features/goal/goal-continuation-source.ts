import type { UserMessage } from "@vetta/ai";
import type { ContinuationPolicyContext } from "@vetta/runtime-core/kernel";
import type { CodingAgentContinuationSource } from "../../runtime-contracts/index.js";
import type { CodingAgentGoalRuntime } from "./goal-runtime.js";

export class CodingAgentGoalContinuationSource implements CodingAgentContinuationSource {
	constructor(
		private readonly runtime: CodingAgentGoalRuntime,
		private readonly now: () => number,
	) {}

	async collect(context: ContinuationPolicyContext): Promise<readonly UserMessage[]> {
		if (context.signal.aborted) return [];
		const goal = this.runtime.readState();
		if (!goal || goal.status !== "active") return [];
		this.runtime.recordContinuation();
		return [
			{
				role: "user",
				content: [
					{
						type: "text",
						text: `[ephemeral:goal] Continue working toward the active goal. Audit what remains, take the next concrete action, and only stop after updating the goal to complete, blocked, or paused when that status is accurate.\n\n<goal_objective>\n${goal.objective}\n</goal_objective>`,
					},
				],
				timestamp: this.now(),
			},
		];
	}
}
