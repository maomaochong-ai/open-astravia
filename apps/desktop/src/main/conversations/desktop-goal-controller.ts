import {
	CODING_AGENT_GOAL_CLEAR,
	CODING_AGENT_GOAL_CREATE,
	CODING_AGENT_GOAL_STATE_READ,
	CODING_AGENT_GOAL_UPDATE,
	type CodingAgentGoalSnapshot,
	type CodingAgentGoalState,
} from "@vetta/coding-agent/session-extensions";
import type { RuntimeHost } from "@vetta/runtime-core";

type GoalRuntimeHost = Pick<RuntimeHost, "abort" | "continue" | "getState" | "invokeSessionExtension">;

/** Desktop 用户动作的唯一编排点；IPC 只校验并转发。 */
export class DesktopGoalController {
	constructor(private readonly runtime: GoalRuntimeHost) {}

	read(sessionId: string): Promise<CodingAgentGoalSnapshot> {
		return this.runtime.invokeSessionExtension(sessionId, CODING_AGENT_GOAL_STATE_READ, undefined);
	}

	async start(sessionId: string, objective: string): Promise<CodingAgentGoalState> {
		const goal = await this.runtime.invokeSessionExtension(sessionId, CODING_AGENT_GOAL_CREATE, {
			objective,
		});
		try {
			if (!this.runtime.getState(sessionId).isStreaming) await this.runtime.continue(sessionId);
			return goal;
		} catch (error) {
			await this.runtime
				.invokeSessionExtension(sessionId, CODING_AGENT_GOAL_UPDATE, {
					goalId: goal.goalId,
					status: "paused",
					statusDetail: "The session could not start",
				})
				.catch(() => undefined);
			throw error;
		}
	}

	async pause(sessionId: string, goalId: string): Promise<CodingAgentGoalState> {
		const goal = await this.runtime.invokeSessionExtension(sessionId, CODING_AGENT_GOAL_UPDATE, {
			goalId,
			status: "paused",
		});
		if (this.runtime.getState(sessionId).isStreaming) await this.runtime.abort(sessionId);
		return goal;
	}

	async resume(sessionId: string, goalId: string): Promise<CodingAgentGoalState> {
		const goal = await this.runtime.invokeSessionExtension(sessionId, CODING_AGENT_GOAL_UPDATE, {
			goalId,
			status: "active",
		});
		try {
			await this.runtime.continue(sessionId);
			return goal;
		} catch (error) {
			await this.runtime
				.invokeSessionExtension(sessionId, CODING_AGENT_GOAL_UPDATE, {
					goalId,
					status: "paused",
					statusDetail: "The session could not resume",
				})
				.catch(() => undefined);
			throw error;
		}
	}

	async clear(sessionId: string, goalId: string): Promise<null> {
		const result = await this.runtime.invokeSessionExtension(sessionId, CODING_AGENT_GOAL_CLEAR, { goalId });
		if (this.runtime.getState(sessionId).isStreaming) await this.runtime.abort(sessionId);
		return result;
	}
}
